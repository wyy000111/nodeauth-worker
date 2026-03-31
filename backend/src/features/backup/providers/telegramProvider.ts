import { BackupProvider, BackupFile } from '@/features/backup/providers/backupProvider';
import { backupTelegramHistory } from '@/shared/db/schema';
import { eq, desc, and } from 'drizzle-orm';

export class TelegramProvider implements BackupProvider {
    private botToken: string;
    private chatId: string;
    private db: any;
    private providerId: number | undefined;

    constructor(config: any, db?: any, providerId?: number) {
        if (!config.botToken || !config.chatId) {
            throw new Error('telegram_config_incomplete');
        }

        this.botToken = config.botToken;
        this.chatId = config.chatId;
        this.db = db;
        this.providerId = providerId;
    }

    private getApiUrl(method: string): string {
        return `https://api.telegram.org/bot${this.botToken}/${method}`;
    }

    async testConnection(): Promise<boolean> {
        // Send a message and delete it immediately
        const sendUrl = this.getApiUrl('sendMessage');

        try {
            const sendRes = await fetch(sendUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.chatId,
                    text: '🔗 NodeAuth Backup Connected / 备份源连接成功',
                    disable_notification: true
                })
            });

            if (!sendRes.ok) {
                const errResult = (await sendRes.json()) as any;
                throw new Error(`telegram_api_error: ${errResult.description}`);
            }

            const sendResult = (await sendRes.json()) as any;
            const messageId = sendResult.result.message_id;

            // Try to delete immediately
            const deleteUrl = this.getApiUrl('deleteMessage');
            await fetch(deleteUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.chatId,
                    message_id: messageId
                })
            });

            return true;
        } catch (e: any) {
            throw e;
        }
    }

    async listBackups(): Promise<BackupFile[]> {
        if (!this.db || !this.providerId) {
            throw new Error('telegram_db_missing');
        }

        const histories = await this.db.select()
            .from(backupTelegramHistory)
            .where(eq(backupTelegramHistory.providerId, this.providerId))
            .orderBy(desc(backupTelegramHistory.createdAt));

        return histories.map((h: any) => ({
            filename: h.filename,
            size: h.size,
            lastModified: new Date(h.createdAt).toISOString()
        }));
    }

    async uploadBackup(filename: string, data: string): Promise<void> {
        if (!this.db || !this.providerId) {
            throw new Error('telegram_db_missing');
        }

        // Use sendDocument
        const sendUrl = this.getApiUrl('sendDocument');
        const formData = new FormData();
        formData.append('chat_id', this.chatId);

        // Convert string data to Blob
        const blob = new Blob([data], { type: 'application/json' });
        formData.append('document', blob, filename);

        const res = await fetch(sendUrl, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            const errResult = (await res.json()) as any;
            throw new Error(`telegram_upload_failed: ${errResult.description}`);
        }

        const result = (await res.json()) as any;
        const document = result.result.document;
        const messageId = result.result.message_id;
        const fileId = document.file_id;
        const fileSize = document.file_size || data.length;

        // Store in DB
        await this.db.insert(backupTelegramHistory).values({
            providerId: this.providerId,
            filename: filename,
            fileId: fileId,
            messageId: messageId,
            size: fileSize,
            createdAt: Date.now()
        });
    }

    async downloadBackup(filename: string): Promise<string> {
        if (!this.db || !this.providerId) {
            throw new Error('telegram_db_missing');
        }

        // Find fileId
        const _fileRecord = await this.db.select()
            .from(backupTelegramHistory)
            .where(and(eq(backupTelegramHistory.providerId, this.providerId), eq(backupTelegramHistory.filename, filename)))
            .limit(1);

        const fileRecord = _fileRecord[0];

        if (!fileRecord) {
            throw new Error('file_not_found_in_history');
        }

        // Get file path
        const getFileUrl = this.getApiUrl('getFile') + `?file_id=${fileRecord.fileId}`;
        const fileInfoRes = await fetch(getFileUrl);
        if (!fileInfoRes.ok) {
            const errResult = (await fileInfoRes.json()) as any;
            if (fileInfoRes.status === 400 && errResult.description && errResult.description.includes('file is unavailable')) {
                throw new Error('FILE_UNAVAILABLE');
            }
            throw new Error(`telegram_download_failed: ${errResult.description}`);
        }
        const fileInfo = (await fileInfoRes.json()) as any;
        const filePath = fileInfo.result.file_path;

        if (!filePath) {
            throw new Error('telegram_file_path_missing');
        }

        // Download actual file content
        const downloadUrl = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
        const downloadRes = await fetch(downloadUrl);
        if (!downloadRes.ok) throw new Error(`telegram_download_failed: ${downloadRes.statusText}`);

        return await downloadRes.text();
    }

    async deleteBackup(filename: string): Promise<void> {
        if (!this.db || !this.providerId) {
            throw new Error('telegram_db_missing');
        }

        const _fileRecord = await this.db.select()
            .from(backupTelegramHistory)
            .where(and(eq(backupTelegramHistory.providerId, this.providerId), eq(backupTelegramHistory.filename, filename)))
            .limit(1);

        const fileRecord = _fileRecord[0];

        if (!fileRecord) {
            // Already gone
            return;
        }

        try {
            // Delete message from telegram
            const deleteUrl = this.getApiUrl('deleteMessage');
            await fetch(deleteUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.chatId,
                    message_id: fileRecord.messageId
                })
            });
        } catch (e) {
            console.error(`Error deleting message from Telegram:`, e);
            // We ignore Telegram errors here because it might be already deleted by the user
        }

        // Finally, remove from DB
        await this.db.delete(backupTelegramHistory)
            .where(eq(backupTelegramHistory.id, fileRecord.id));
    }
}
