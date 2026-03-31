import { AwsClient } from 'aws4fetch';
import { BackupProvider, BackupFile } from '@/features/backup/providers/backupProvider';

export class S3Provider implements BackupProvider {
    private client: AwsClient;
    private bucket: string;
    private endpoint: string;
    private prefix: string;

    constructor(config: any) {
        if (!config.endpoint || !config.accessKeyId || !config.secretAccessKey || !config.bucket) {
            throw new Error('s3_config_incomplete');
        }

        this.client = new AwsClient({
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            region: config.region || 'auto',
            service: 's3',
        });

        this.bucket = config.bucket;
        // 移除 endpoint 末尾的斜杠
        this.endpoint = config.endpoint.replace(/\/+$/, '');

        // 处理前缀 (目录)，确保不以 / 开头，但以 / 结尾
        this.prefix = (config.saveDir || '').trim();
        if (this.prefix.startsWith('/')) this.prefix = this.prefix.slice(1);
        if (this.prefix.length > 0 && !this.prefix.endsWith('/')) this.prefix += '/';
    }

    // 构造 Path-Style URL: endpoint/bucket/key
    // 这种方式兼容性最好 (支持 R2, MinIO 等)
    private getUrl(key: string = '', params: Record<string, string> = {}): string {
        const url = new URL(`${this.endpoint}/${this.bucket}/${key}`);
        Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
        return url.toString();
    }

    async testConnection(): Promise<boolean> {
        // 使用 list-type=2 获取少量文件来测试权限和连通性
        const url = this.getUrl('', { 'list-type': '2', 'max-keys': '1' });
        const res = await this.client.fetch(url);
        if (!res.ok) {
            throw new Error(`s3_api_error: ${res.status} ${res.statusText}`);
        }
        return true;
    }

    async listBackups(): Promise<BackupFile[]> {
        const url = this.getUrl('', { 'list-type': '2', 'prefix': this.prefix });
        const res = await this.client.fetch(url);
        if (!res.ok) throw new Error(`s3_list_failed: ${res.status}`);

        const text = await res.text();

        // 简单的 XML 解析 (避免引入庞大的 XML 解析库)
        // 提取 <Contents> 块中的 Key, LastModified, Size
        const backups: BackupFile[] = [];
        const regex = /<Contents>[\s\S]*?<Key>(.*?)<\/Key>[\s\S]*?<LastModified>(.*?)<\/LastModified>[\s\S]*?<Size>(.*?)<\/Size>[\s\S]*?<\/Contents>/g;

        let match;
        while ((match = regex.exec(text)) !== null) {
            const fullKey = match[1];
            const lastModified = match[2];
            const size = parseInt(match[3], 10);

            // 过滤掉非 JSON 备份文件
            const filename = fullKey.replace(this.prefix, '');
            if (filename.startsWith('nodeauth-backup-') && filename.endsWith('.json')) {
                backups.push({
                    filename: filename,
                    size: size,
                    lastModified: lastModified
                });
            }
        }

        return backups.sort((a, b) => b.filename.localeCompare(a.filename));
    }

    async uploadBackup(filename: string, data: string): Promise<void> {
        const key = this.prefix + filename;
        const url = this.getUrl(key);

        const res = await this.client.fetch(url, {
            method: 'PUT',
            body: data,
            headers: { 'Content-Type': 'application/json' }
        });

        if (!res.ok) throw new Error(`s3_upload_failed: ${res.status}`);
    }

    async downloadBackup(filename: string): Promise<string> {
        const key = this.prefix + filename;
        const url = this.getUrl(key);
        const res = await this.client.fetch(url);
        if (!res.ok) throw new Error(`s3_download_failed: ${res.status}`);
        return await res.text();
    }

    async deleteBackup(filename: string): Promise<void> {
        const key = this.prefix + filename;
        const url = this.getUrl(key);
        const res = await this.client.fetch(url, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error(`s3_delete_failed: ${res.status}`);
    }
}