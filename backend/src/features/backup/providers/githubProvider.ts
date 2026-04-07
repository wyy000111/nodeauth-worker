import { BackupProvider, BackupFile } from '@/features/backup/providers/backupProvider';
import { AppError } from '@/app/config';

export class GithubProvider implements BackupProvider {
    private token: string;
    private owner: string;
    private repo: string;
    private branch: string;
    private saveDir: string;
    public onConfigUpdate?: (newConfig: any) => Promise<void>;

    constructor(config: { token: string, owner: string, repo: string, branch?: string, saveDir?: string }) {
        this.token = config.token;
        this.owner = config.owner;
        this.repo = config.repo;
        this.branch = config.branch || 'main'; // default to main
        this.saveDir = (config.saveDir || '/nodeauth-backup').replace(/^\/+|\/+$/g, '');
    }

    private getApiUrl(path: string) {
        return `https://api.github.com/repos/${this.owner}/${this.repo}${path}`;
    }

    private async request(path: string, options: RequestInit = {}) {
        const url = this.getApiUrl(path);
        const headers = new Headers(options.headers || {});
        headers.set('Authorization', `Bearer ${this.token}`);
        headers.set('Accept', 'application/vnd.github.v3+json');
        headers.set('X-GitHub-Api-Version', '2022-11-28');
        headers.set('User-Agent', 'NodeAuth-Backup');

        const res = await fetch(url, { ...options, headers });
        const data: any = await res.json().catch(() => null);

        if (!res.ok) {
            if (res.status === 401) {
                throw new AppError('oauth_token_revoked', 401);
            }
            if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
                throw new AppError('github_rate_limit_exceeded', 429);
            }
            throw new AppError(data?.message || `GitHub API Error ${res.status}`, res.status);
        }

        return data;
    }

    async testConnection(): Promise<boolean> {
        try {
            await this.request('');
            return true;
        } catch (e: any) {
            if (e instanceof AppError) throw e;
            throw new AppError(e.message, 400);
        }
    }

    async listBackups(): Promise<BackupFile[]> {
        try {
            const data = await this.request(`/contents/${this.saveDir}`);
            if (!Array.isArray(data)) {
                return [];
            }

            // GitHub contents API doesn't provide modified date easily.
            // But we will use the commit date or fake it to now if impossible.
            // Try formatting current time as fallback.
            return data.filter((item: any) => item.type === 'file').map((item: any) => ({
                filename: item.name,
                size: item.size,
                lastModified: new Date().toISOString()
            }));
        } catch (e: any) {
            if (e.statusCode === 404 || e.status === 404) return [];
            throw e;
        }
    }

    async uploadBackup(filename: string, content: string): Promise<void> {
        const path = `/contents/${this.saveDir ? this.saveDir + '/' : ''}${filename}`;

        // Use Web Standard btoa + TextEncoder for Cloudflare Worker compatibility (Buffer is not defined)
        // Using a loop instead of spread operator to avoid "Maximum call stack size exceeded" for large payloads
        const bytes = new TextEncoder().encode(content);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64Content = btoa(binary);

        let sha: string | undefined;
        try {
            const existing: any = await this.request(path);
            if (existing && existing.sha) {
                sha = existing.sha;
            }
        } catch (e: any) {
            // Ignore if file doesn't exist (e.g. 404)
        }

        let bodyObj: any = {
            message: `NodeAuth Backup: ${filename}`,
            content: base64Content,
            sha
        };
        // Option to include branch if not default
        if (this.branch) {
            bodyObj.branch = this.branch;
        }
        const body = JSON.stringify(bodyObj);

        await this.request(path, { method: 'PUT', body });
    }

    async downloadBackup(filename: string): Promise<string> {
        const path = `/contents/${this.saveDir ? this.saveDir + '/' : ''}${filename}`;
        const data: any = await this.request(path);
        if (data.encoding === 'base64') {
            // Use Web Standard atob + TextDecoder for Cloudflare Worker compatibility
            const binary = atob(data.content);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return new TextDecoder().decode(bytes);
        }
        throw new AppError('invalid_file_encoding', 500);
    }

    async deleteBackup(filename: string): Promise<void> {
        const path = `/contents/${this.saveDir ? this.saveDir + '/' : ''}${filename}`;

        let sha: string;
        try {
            const existing: any = await this.request(path);
            if (existing && existing.sha) {
                sha = existing.sha;
            } else {
                throw new AppError('file_not_found', 404);
            }
        } catch (e: any) {
            if (e.statusCode === 404 || e.status === 404) return;
            throw e;
        }

        let bodyObj: any = {
            message: `NodeAuth Delete Backup: ${filename}`,
            sha
        };
        if (this.branch) {
            bodyObj.branch = this.branch;
        }
        const body = JSON.stringify(bodyObj);

        await this.request(path, { method: 'DELETE', body });
    }
}
