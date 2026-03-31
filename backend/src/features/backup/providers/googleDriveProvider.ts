import { BackupProvider, BackupFile } from '@/features/backup/providers/backupProvider';
import { AppError } from '@/app/config';

export class GoogleDriveProvider implements BackupProvider {
    private clientId: string;
    private clientSecret: string;
    private refreshToken: string;
    private accessToken: string | null = null;
    private folderId: string | null;

    private saveDir: string;
    private config: any;

    public onConfigUpdate?: (newConfig: any) => Promise<void>;

    constructor(config: any, env: any) {
        this.config = config;
        this.clientId = env.OAUTH_GOOGLE_CLIENT_ID;
        this.clientSecret = env.OAUTH_GOOGLE_CLIENT_SECRET;

        if (!config.refreshToken) {
            throw new Error('gdrive_token_missing');
        }
        this.refreshToken = config.refreshToken;

        // 兼容处理：优先使用 folderId，如果没有则尝试从 saveDir 解析
        this.folderId = config.folderId || null;
        this.saveDir = config.saveDir || '/nodeauth-backup';
    }

    private async resolveFolderId(): Promise<string | null> {
        if (this.folderId) return this.folderId;
        if (!this.saveDir || this.saveDir === '/' || this.saveDir === '') return null;

        const token = await this.getAccessToken();
        const parts = this.saveDir.split('/').filter(p => p !== '');
        let currentParentId: string | null = null;

        for (const part of parts) {
            const query = `name = '${part}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${currentParentId ? ` and '${currentParentId}' in parents` : " and 'root' in parents"}`;
            const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`;
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) throw new Error(`gdrive_resolve_folder_failed: ${res.status}`);
            const data = await res.json() as any;

            if (data.files && data.files.length > 0) {
                currentParentId = data.files[0].id;
            } else {
                // 创建文件夹
                const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: part,
                        mimeType: 'application/vnd.google-apps.folder',
                        parents: currentParentId ? [currentParentId] : undefined
                    })
                });

                if (!createRes.ok) throw new Error('gdrive_create_folder_failed');
                const newData = await createRes.json() as any;
                currentParentId = newData.id;
            }
        }

        this.folderId = currentParentId;
        return this.folderId;
    }

    private async getAccessToken(): Promise<string> {
        if (this.accessToken) return this.accessToken;

        const res = await fetch('https://oauth2.googleapis.com/token', {
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
            if (errorDesc.includes('invalid_grant') || errorDesc.includes('unauthorized') || res.status === 401) {
                // Throw the project-standard error code for revoked tokens
                throw new AppError('oauth_token_revoked', 401);
            }
            throw new Error(`gdrive_auth_failed: ${err.error_description || res.statusText}`);
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
        await this.resolveFolderId();
        // Try a simple list request
        await this.listBackups();
        return true;
    }

    async listBackups(): Promise<BackupFile[]> {
        const token = await this.getAccessToken();
        const fId = await this.resolveFolderId();

        let query = "name contains 'nodeauth-backup-' and trashed = false";
        if (fId) {
            query += ` and '${fId}' in parents`;
        } else {
            query += " and 'root' in parents";
        }

        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,size,modifiedTime)&orderBy=name desc`;

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error(`gdrive_list_failed: ${res.status}`);

        const data = await res.json() as any;
        return (data.files || []).map((f: any) => ({
            filename: f.name,
            size: parseInt(f.size || '0', 10),
            lastModified: f.modifiedTime
        }));
    }

    async uploadBackup(filename: string, data: string): Promise<void> {
        const token = await this.getAccessToken();
        const fId = await this.resolveFolderId();

        const metadata = {
            name: filename,
            parents: fId ? [fId] : undefined
        };

        const boundary = '-------nodeauth_worker_boundary';
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelimiter = `\r\n--${boundary}--`;

        const body =
            delimiter +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            data +
            closeDelimiter;

        const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': `multipart/related; boundary=${boundary}`
            },
            body: body
        });

        if (!res.ok) {
            const err = await res.json() as any;
            throw new Error(`gdrive_upload_failed: ${err.error?.message || res.statusText}`);
        }
    }

    async downloadBackup(filename: string): Promise<string> {
        const token = await this.getAccessToken();
        const fileId = await this.getFileIdByName(filename);

        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error(`gdrive_download_failed: ${res.status}`);
        return await res.text();
    }

    async deleteBackup(filename: string): Promise<void> {
        const token = await this.getAccessToken();
        const fileId = await this.getFileIdByName(filename);

        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error(`gdrive_delete_failed: ${res.status}`);
    }

    private async getFileIdByName(filename: string): Promise<string> {
        const token = await this.getAccessToken();
        let query = `name = '${filename}' and trashed = false`;
        if (this.folderId) {
            query += ` and '${this.folderId}' in parents`;
        }

        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`;
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error(`gdrive_find_file_failed: ${res.status}`);
        const data = await res.json() as any;
        if (!data.files || data.files.length === 0) throw new Error('file_not_found');

        return data.files[0].id;
    }
}
