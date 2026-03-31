import { BackupProvider } from '@/features/backup/providers/backupProvider';
import { EnvBindings, AppError } from '@/app/config';

export class OneDriveProvider implements BackupProvider {
    private refreshToken: string;
    private folderId: string | null = null;
    private saveDir: string;
    private env: EnvBindings;
    private config: any;
    private accessToken: string | null = null;
    private tokenExpiry: number = 0;

    constructor(config: any, env: EnvBindings) {
        this.config = config;
        this.refreshToken = config.refreshToken;
        this.saveDir = config.saveDir || '/nodeauth-backup';
        this.env = env;
    }

    public onConfigUpdate?: (newConfig: any) => Promise<void>;

    private async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        const clientId = this.env.OAUTH_MICROSOFT_CLIENT_ID;
        const clientSecret = this.env.OAUTH_MICROSOFT_CLIENT_SECRET;

        if (!clientId) {
            throw new Error('OAUTH_MICROSOFT_CLIENT_ID is not configured');
        }

        const params = new URLSearchParams({
            client_id: clientId,
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken,
        });

        if (clientSecret) {
            params.append('client_secret', clientSecret);
        }

        const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        });

        if (!res.ok) {
            const err = await res.json() as any;
            const errorDesc = (err.error_description || err.error || '').toLowerCase();
            if (errorDesc.includes('invalid_grant') || errorDesc.includes('aadsts70000')) {
                throw new AppError('oauth_token_revoked', 401);
            }
            throw new Error(`Failed to refresh token: ${err.error_description || err.error}`);
        }

        const data = await res.json() as any;
        this.accessToken = data.access_token;
        // token 取 90% 的有效期作为本地过期时间，防止边缘情况失效
        this.tokenExpiry = Date.now() + (data.expires_in * 1000 * 0.9);

        // 如果获取了新的 refreshToken（有时候微软会轮换）
        if (data.refresh_token && data.refresh_token !== this.refreshToken) {
            this.refreshToken = data.refresh_token;
            if (this.onConfigUpdate) {
                await this.onConfigUpdate({
                    ...this.config,
                    refreshToken: this.refreshToken
                });
            }
        }

        return this.accessToken!;
    }

    private normalizePath(path: string): string {
        // 去除多余的斜杠，并确保开头有斜杆，结尾没有
        let p = path.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
        if (!p.startsWith('/')) p = '/' + p;
        if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1);
        if (p === '/') return ''; // AppRoot 根目录
        return ':' + p + ':'; // Graph API 相对路径格式需要用冒号包裹，例如 /me/drive/special/approot:/folder:
    }

    async testConnection(): Promise<boolean> {
        const token = await this.getAccessToken();
        let res = await fetch('https://graph.microsoft.com/v1.0/me/drive/special/approot', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            const err = await res.json() as any;
            const errMsg = err.error?.message || res.statusText;

            // "User is pending provisioning" indicates the drive or special folder isn't ready.
            // Let's at least test if the token is valid for the basic /me endpoint as a fallback.
            if (errMsg.toLowerCase().includes('pending provisioning') || res.status === 404) {
                const fallbackRes = await fetch('https://graph.microsoft.com/v1.0/me', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!fallbackRes.ok) {
                    const fallbackErr = await fallbackRes.json() as any;
                    throw new Error(`Connection test failed: ${fallbackErr.error?.message || fallbackRes.statusText}`);
                }
                return true; // Token is valid, Microsoft is just being slow with setup
            }

            throw new Error(`Connection test failed: ${errMsg}`);
        }
        return true;
    }

    async uploadBackup(filename: string, content: string): Promise<void> {
        const token = await this.getAccessToken();
        const normPath = this.normalizePath(`${this.saveDir}/${filename}`);
        const url = `https://graph.microsoft.com/v1.0/me/drive/special/approot${normPath}/content`;

        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: content
        });

        if (!res.ok) {
            const err = await res.json() as any;
            throw new Error(`Upload failed: ${err.error?.message || res.statusText}`);
        }
    }

    async downloadBackup(filename: string): Promise<string> {
        const token = await this.getAccessToken();
        const normPath = this.normalizePath(`${this.saveDir}/${filename}`);
        const url = `https://graph.microsoft.com/v1.0/me/drive/special/approot${normPath}/content`;

        // We must use redirect: 'manual' because OneDrive returns a 302 redirect to a pre-authenticated URL.
        // If fetch follows the redirect automatically, it forwards the 'Authorization' header, 
        // which causes the target storage server to reject the request with 401 Unauthenticated.
        let res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` },
            redirect: 'manual'
        });

        // Handle the redirect manually without the Authorization header
        if (res.status >= 300 && res.status < 400) {
            const redirectUrl = res.headers.get('Location');
            if (redirectUrl) {
                res = await fetch(redirectUrl);
            }
        }

        if (!res.ok) {
            if (res.status === 404) throw new Error('File not found');

            let errMsg = res.statusText;
            try {
                const err = await res.clone().json() as any;
                errMsg = err.error?.message || err.message || errMsg;
            } catch (e) {
                const errText = await res.text();
                errMsg = errText || errMsg;
            }
            throw new Error(`Download failed: ${errMsg}`);
        }

        return await res.text();
    }

    async listBackups(): Promise<any[]> {
        const token = await this.getAccessToken();
        const normPath = this.normalizePath(this.saveDir);

        // 如果是要列出根目录，直接使用 approot/children
        // 否则使用 approot:/folder:/children
        const urlEnd = normPath === '' ? '/children' : `${normPath}/children`;
        const url = `https://graph.microsoft.com/v1.0/me/drive/special/approot${urlEnd}`;

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            if (res.status === 404) return []; // 目录不存在，返回空列表
            const err = await res.json() as any;
            throw new Error(`List failed: ${err.error?.message || res.statusText}`);
        }

        const data = await res.json() as any;
        if (!data.value) return [];

        return data.value
            .filter((item: any) => item.file) // 过滤掉文件夹
            .map((item: any) => ({
                filename: item.name,
                size: item.size,
                lastModified: item.lastModifiedDateTime,
                id: item.id
            }))
            .sort((a: any, b: any) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
    }

    async deleteBackup(filename: string): Promise<void> {
        const token = await this.getAccessToken();
        const normPath = this.normalizePath(`${this.saveDir}/${filename}`);
        const url = `https://graph.microsoft.com/v1.0/me/drive/special/approot${normPath}`;

        const res = await fetch(url, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok && res.status !== 404) {
            const err = await res.json() as any;
            throw new Error(`Delete failed: ${err.error?.message || res.statusText}`);
        }
    }
}
