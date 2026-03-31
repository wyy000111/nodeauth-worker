import { createClient, WebDAVClient } from 'webdav';
import { BackupProvider, BackupFile } from '@/features/backup/providers/backupProvider';

export class WebDavProvider implements BackupProvider {
    private client: WebDAVClient;
    private saveDir: string;
    private config: any;

    constructor(config: any) {
        if (!config.url || !config.username || !config.password) {
            throw new Error('webdav_config_incomplete');
        }
        this.config = config;
        this.client = createClient(config.url, {
            username: config.username,
            password: config.password
        });

        // 标准化 saveDir: 确保以 / 开头，且不以 / 结尾 (除非是根目录)
        let dir = (config.saveDir || '/').trim();
        if (!dir.startsWith('/')) dir = '/' + dir;
        if (dir.length > 1 && dir.endsWith('/')) dir = dir.slice(0, -1);

        this.saveDir = dir;
    }

    async testConnection(): Promise<boolean> {
        await this.client.getDirectoryContents('/');
        return true;
    }

    async listBackups(): Promise<BackupFile[]> {
        const items = await this.client.getDirectoryContents(this.saveDir);
        return (items as any[])
            .filter(item => item.type === 'file' && item.basename.startsWith('nodeauth-backup-') && item.basename.endsWith('.json'))
            .map(item => {
                // Try to parse date from filename if lastmod is missing or generic
                let displayTime = item.lastmod;
                return {
                    filename: item.basename,
                    path: item.filename, // 返回 WebDAV 服务器提供的绝对路径
                    size: item.size,
                    lastModified: displayTime
                };
            })
            .sort((a, b) => b.filename.localeCompare(a.filename));
    }

    private getAuthHeader() {
        const str = `${this.config.username}:${this.config.password}`;
        try { return 'Basic ' + btoa(unescape(encodeURIComponent(str))); }
        catch { return 'Basic ' + btoa(str); }
    }

    private getRequestUrl(path: string) {
        let baseUrl = this.config.url.trim();
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        let cleanPath = path.replace(/\/+/g, '/');
        if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;
        const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/');
        const cleanUrl = new URL(baseUrl + encodedPath);
        cleanUrl.username = '';
        cleanUrl.password = '';
        return cleanUrl.toString();
    }

    async uploadBackup(filename: string, data: string): Promise<void> {
        const fullPath = this.saveDir === '/' ? `/${filename}` : `${this.saveDir}/${filename}`;

        // 核心修复: 将 payload 字符串强制转换为 ArrayBuffer (Uint8Array的底层Buffer)，
        // 这将阻止底层 fetch / axios 遇到大文本时采用 "Transfer-Encoding: chunked" 分块流传输。
        // Nextcloud (SabreDAV) 出于严格审查拒绝接受分块流，从而避免报出 8KB 截断或 400 Bad Request。
        const bufferData = new TextEncoder().encode(data).buffer;

        try {
            if (this.saveDir !== '/') {
                const dirExists = await this.client.exists(this.saveDir);
                if (!dirExists) {
                    await this.client.createDirectory(this.saveDir);
                }
            }
            await this.client.putFileContents(fullPath, bufferData as any);
        } catch (e: any) {
            console.error('[WebDAV Fallback] Original upload failed:', e.message);
            // Fallback for strict WebDAV servers like Nextcloud (400 Bad Request, 405 Method Not Allowed)
            if (this.saveDir !== '/') {
                const dirUrl = this.getRequestUrl(this.saveDir);
                await fetch(dirUrl, { method: 'MKCOL', headers: { 'Authorization': this.getAuthHeader() } }).catch(() => { });
            }

            const fileUrl = this.getRequestUrl(fullPath);
            const res = await fetch(fileUrl, {
                method: 'PUT',
                body: bufferData,
                headers: {
                    'Authorization': this.getAuthHeader(),
                    'Content-Type': 'application/json',
                    'Content-Length': bufferData.byteLength.toString() // 依然显式声明长度确保稳妥
                }
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(`webdav_upload_failed: ${res.status} ${res.statusText} ${errText}`);
            }
        }
    }

    async downloadBackup(filename: string): Promise<string> {
        const cleanFilename = filename.trim().replace(/^\/+/, '');
        const fullPath = this.saveDir === '/' ? `/${cleanFilename}` : `${this.saveDir}/${cleanFilename}`;

        try {
            const content = await this.client.getFileContents(fullPath, { format: 'text' });
            return content as string;
        } catch (e: any) {
            console.error('[WebDAV Fallback] Original download failed:', e.message);
            // 应对重定向跨站或者特殊 CDN 的强壮 Native Fetch Fallback
            const fileUrl = this.getRequestUrl(fullPath);

            // 阶段 1：尝试不跟随重定向，拦截 301/302 以获取被保护的实际下载直链
            const res = await fetch(fileUrl, {
                headers: { 'Authorization': this.getAuthHeader() },
                redirect: 'manual'
            });

            if (res.status >= 300 && res.status < 400) {
                const redirectUrl = res.headers.get('location');
                if (redirectUrl) {
                    // 由于跨域重定向规范限制，直接抓取 location 发出裸请求（通常是带有签名的 CDN 下载直链，已无需附带 Authorization）
                    const finalRes = await fetch(redirectUrl);
                    if (!finalRes.ok) throw new Error(`webdav_download_redirect_failed: ${finalRes.status}`);
                    return await finalRes.text();
                }
            } else if (!res.ok) {
                throw new Error(`webdav_download_failed: ${res.status} ${res.statusText}`);
            }

            return await res.text();
        }
    }

    async deleteBackup(filename: string): Promise<void> {
        const cleanFilename = filename.trim().replace(/^\/+/, '');
        const fullPath = this.saveDir === '/' ? `/${cleanFilename}` : `${this.saveDir}/${cleanFilename}`;

        try {
            await this.client.deleteFile(fullPath);
        } catch (e: any) {
            console.error('[WebDAV Fallback] Original delete failed:', e.message);
            const fileUrl = this.getRequestUrl(fullPath);
            const res = await fetch(fileUrl, {
                method: 'DELETE',
                headers: { 'Authorization': this.getAuthHeader() }
            });
            if (!res.ok) throw new Error(`webdav_delete_failed: ${res.status} ${res.statusText}`);
        }
    }
}