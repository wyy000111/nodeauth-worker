import { BackupProvider, BackupFile } from '@/features/backup/providers/backupProvider';
import { EnvBindings, AppError } from '@/app/config';

export class BaiduNetdiskProvider implements BackupProvider {
    private clientId: string;
    private clientSecret: string;
    private refreshToken: string;
    private accessToken: string | null = null;
    private tokenExpiry: number = 0;
    private saveDir: string;
    private env: EnvBindings;
    private config: any;

    public onConfigUpdate?: (newConfig: any) => Promise<void>;

    constructor(config: any, env: EnvBindings) {
        this.config = config;
        this.clientId = env.OAUTH_BAIDU_CLIENT_ID || '';
        this.clientSecret = env.OAUTH_BAIDU_CLIENT_SECRET || '';
        this.refreshToken = config.refreshToken;
        this.saveDir = config.saveDir || '/apps/nodeauth-backup';
        this.env = env;

        if (!this.clientId) {
            throw new Error('OAUTH_BAIDU_CLIENT_ID is not configured');
        }
    }

    private async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken,
            client_id: this.clientId,
            client_secret: this.clientSecret,
        });

        const res = await fetch(`https://openapi.baidu.com/oauth/2.0/token?${params.toString()}`, {
            method: 'GET'
        });

        if (!res.ok) {
            const err = await res.json() as any;
            const errorDesc = (err.error_description || err.error || '').toLowerCase();
            if (errorDesc.includes('invalid_grant') || res.status === 401) {
                throw new AppError('oauth_token_revoked', 401);
            }
            throw new Error(`Baidu Auth Failed: ${errorDesc || res.statusText}`);
        }

        const data = await res.json() as any;
        this.accessToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in * 1000 * 0.9);

        if (data.refresh_token && data.refresh_token !== this.refreshToken) {
            this.refreshToken = data.refresh_token;
            if (this.onConfigUpdate) {
                await this.onConfigUpdate({ ...this.config, refreshToken: this.refreshToken });
            }
        }

        return this.accessToken!;
    }

    async testConnection(): Promise<boolean> {
        await this.getAccessToken();
        // Try to get quota or user info to test connection
        const token = await this.getAccessToken();
        const res = await fetch(`https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo&access_token=${token}`);
        if (!res.ok) {
            const err = await res.json() as any;
            throw new Error(`Connection test failed: ${err.errmsg || res.statusText}`);
        }
        return true;
    }

    async listBackups(): Promise<BackupFile[]> {
        const token = await this.getAccessToken();
        const url = `https://pan.baidu.com/rest/2.0/xpan/file?method=list&dir=${encodeURIComponent(this.saveDir)}&access_token=${token}`;

        const res = await fetch(url);
        if (!res.ok) {
            if (res.status === 404) return [];
            throw new Error(`List failed: ${res.statusText}`);
        }

        const data = await res.json() as any;
        if (data.errno !== 0) {
            if (data.errno === -9) return []; // Directory not found
            throw new Error(`Baidu List Error: ${data.errno}`);
        }

        return (data.list || [])
            .filter((item: any) => item.isdir === 0 && item.server_filename.startsWith('nodeauth-backup-'))
            .map((item: any) => ({
                filename: item.server_filename,
                size: item.size,
                lastModified: new Date(item.server_mtime * 1000).toISOString()
            }))
            .sort((a: any, b: any) => b.filename.localeCompare(a.filename));
    }

    private async calculateMD5(content: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        try {
            const hashBuffer = await crypto.subtle.digest('MD5', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            // Basic fallback if MD5 is not supported in WebCrypto (legacy environments)
            // But Cloudflare Workers usually support it now.
            return "0";
        }
    }

    async uploadBackup(filename: string, content: string): Promise<void> {
        const token = await this.getAccessToken();
        const path = `${this.saveDir}/${filename}`;
        const contentBlob = new Blob([content]);
        const size = contentBlob.size;
        const md5 = await this.calculateMD5(content);

        // Step 1: Pre-create
        const precreateUrl = `https://pan.baidu.com/rest/2.0/xpan/file?method=precreate&access_token=${token}`;
        const precreateRes = await fetch(precreateUrl, {
            method: 'POST',
            body: new URLSearchParams({
                path: path,
                size: size.toString(),
                isdir: '0',
                autoinit: '1',
                rtype: '3', // 3: Overwrite
                block_list: JSON.stringify([md5])
            })
        });

        const precreateData = await precreateRes.json() as any;
        if (precreateData.errno !== 0) {
            throw new Error(`Upload Precreate Failed: ${precreateData.errno}`);
        }

        const uploadid = precreateData.uploadid;

        // Step 2: Upload (Single part)
        const uploadUrl = `https://d.pcs.baidu.com/rest/2.0/pcs/superfile2?method=upload&type=tmpfile&path=${encodeURIComponent(path)}&uploadid=${uploadid}&partseq=0&access_token=${token}`;

        const formData = new FormData();
        formData.append('file', contentBlob, filename);

        const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
        });

        if (!uploadRes.ok) throw new Error(`Upload Chunk Failed: ${uploadRes.statusText}`);

        // Step 3: Create
        const createUrl = `https://pan.baidu.com/rest/2.0/xpan/file?method=create&access_token=${token}`;
        const createRes = await fetch(createUrl, {
            method: 'POST',
            body: new URLSearchParams({
                path: path,
                size: size.toString(),
                isdir: '0',
                uploadid: uploadid,
                block_list: JSON.stringify([md5]),
            })
        });

        const createData = await createRes.json() as any;
        if (createData.errno !== 0) {
            // If it failed due to MD5 mismatch, we might need a better implementation.
            // But let's try a simplified one if PAN API is too strict about MD5 here.
            throw new Error(`Upload Create Failed: ${createData.errno}`);
        }
    }

    async downloadBackup(filename: string): Promise<string> {
        const token = await this.getAccessToken();
        const path = `${this.saveDir}/${filename}`;

        // 1. Get dlink
        const metaUrl = `https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&path=${encodeURIComponent(JSON.stringify([path]))}&dlink=1&access_token=${token}`;
        const metaRes = await fetch(metaUrl);
        const metaData = await metaRes.json() as any;

        if (metaData.errno !== 0 || !metaData.list || metaData.list.length === 0) {
            throw new Error(`Get Download Link Failed: ${metaData.errno}`);
        }

        const dlink = `${metaData.list[0].dlink}&access_token=${token}`;

        // 2. Download with User-Agent
        const res = await fetch(dlink, {
            headers: {
                'User-Agent': 'pan.baidu.com'
            }
        });

        if (!res.ok) throw new Error(`Download Failed: ${res.statusText}`);
        return await res.text();
    }

    async deleteBackup(filename: string): Promise<void> {
        const token = await this.getAccessToken();
        const path = `${this.saveDir}/${filename}`;

        const url = `https://pan.baidu.com/rest/2.0/xpan/file?method=filemanager&opera=delete&access_token=${token}`;
        const res = await fetch(url, {
            method: 'POST',
            body: new URLSearchParams({
                filelist: JSON.stringify([path])
            })
        });

        const data = await res.json() as any;
        if (data.errno !== 0 && data.errno !== -8) { // -8 is not found
            throw new Error(`Delete Failed: ${data.errno}`);
        }
    }
}
