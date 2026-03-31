import { BackupProvider, BackupFile } from '@/features/backup/providers/backupProvider';
import { AppError } from '@/app/config';

export class DropboxProvider implements BackupProvider {
    private clientId: string;
    private clientSecret: string;
    private refreshToken: string;
    private accessToken: string | null = null;
    private saveDir: string;
    private config: any;

    public onConfigUpdate?: (newConfig: any) => Promise<void>;

    constructor(config: any, env: any) {
        this.config = config;
        this.clientId = env.OAUTH_DROPBOX_CLIENT_ID;
        this.clientSecret = env.OAUTH_DROPBOX_CLIENT_SECRET;

        if (!config.refreshToken) {
            throw new Error('dropbox_token_missing');
        }
        this.refreshToken = config.refreshToken;
        this.saveDir = config.saveDir || ''; // Dropbox App Folder is root by default
    }

    private async getAccessToken(): Promise<string> {
        if (this.accessToken) return this.accessToken;

        const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                refresh_token: this.refreshToken,
                grant_type: 'refresh_token'
            })
        });

        if (!res.ok) {
            const err = await res.json() as any;
            const errorDesc = (err.error || err.error_description || '').toLowerCase();
            if (errorDesc.includes('invalid_grant') || res.status === 401) {
                throw new AppError('oauth_token_revoked', 401);
            }
            throw new Error(`dropbox_auth_failed: ${err.error_description || res.statusText}`);
        }

        const data = await res.json() as any;
        this.accessToken = data.access_token;

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
        // Simple list check
        await this.listBackups();
        return true;
    }

    async listBackups(): Promise<BackupFile[]> {
        const token = await this.getAccessToken();
        const path = this.saveDir === '/' || this.saveDir === '' ? '' : (this.saveDir.startsWith('/') ? this.saveDir : '/' + this.saveDir);

        const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: path,
                recursive: false,
                include_media_info: false,
                include_deleted: false
            })
        });

        if (res.status === 409) {
            // Path not found, return empty
            return [];
        }

        if (!res.ok) {
            const err = await res.json() as any;
            if (err?.error?.['.tag'] === 'path' && err?.error?.path?.['.tag'] === 'not_found') {
                return [];
            }
            throw new Error(`dropbox_list_failed: ${res.status}`);
        }

        const data = await res.json() as any;
        return (data.entries || [])
            .filter((f: any) => f['.tag'] === 'file' && f.name.includes('nodeauth-backup-'))
            .map((f: any) => ({
                filename: f.name,
                size: f.size,
                lastModified: f.server_modified
            }));
    }

    async uploadBackup(filename: string, data: string): Promise<void> {
        const token = await this.getAccessToken();
        const path = this.saveDir === '/' || this.saveDir === '' ? '' : (this.saveDir.startsWith('/') ? this.saveDir : '/' + this.saveDir);
        const fullPath = `${path}/${filename}`.replace(/\/+/g, '/');

        const args = {
            path: fullPath,
            mode: 'overwrite',
            autorename: false,
            mute: false,
            strict_conflict: false
        };

        const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Dropbox-API-Arg': JSON.stringify(args),
                'Content-Type': 'application/octet-stream'
            },
            body: data
        });

        if (!res.ok) {
            const err = await res.json() as any;
            throw new Error(`dropbox_upload_failed: ${err.error_summary || res.statusText}`);
        }
    }

    async downloadBackup(filename: string): Promise<string> {
        const token = await this.getAccessToken();
        const path = this.saveDir === '/' || this.saveDir === '' ? '' : (this.saveDir.startsWith('/') ? this.saveDir : '/' + this.saveDir);
        const fullPath = `${path}/${filename}`.replace(/\/+/g, '/');

        const args = {
            path: fullPath
        };

        const res = await fetch('https://content.dropboxapi.com/2/files/download', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Dropbox-API-Arg': JSON.stringify(args)
            }
        });

        if (!res.ok) throw new Error(`dropbox_download_failed: ${res.status}`);
        return await res.text();
    }

    async deleteBackup(filename: string): Promise<void> {
        const token = await this.getAccessToken();
        const path = this.saveDir === '/' || this.saveDir === '' ? '' : (this.saveDir.startsWith('/') ? this.saveDir : '/' + this.saveDir);
        const fullPath = `${path}/${filename}`.replace(/\/+/g, '/');

        const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: fullPath })
        });

        if (!res.ok) {
            const err = await res.json() as any;
            // Ignore if already deleted
            if (err?.error_summary?.includes('path_lookup/not_found')) return;
            throw new Error(`dropbox_delete_failed: ${res.statusText}`);
        }
    }
}
