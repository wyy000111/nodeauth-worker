import { eq, desc } from 'drizzle-orm';
import { backupProviders, type BackupProvider, type NewBackupProvider } from '@/shared/db/schema/index.js';

export class BackupRepository {
    private db: any;

    constructor(dbClient: any) {
        this.db = dbClient;
    }

    /**
     * 获取所有启用的备份提供商配置 (按名称排序)
     */
    async findAllSettings(): Promise<BackupProvider[]> {
        return await this.db
            .select()
            .from(backupProviders)
            .orderBy(desc(backupProviders.updatedAt));
    }

    /**
     * 根据提供商类型获取配置
     */
    async findByType(type: string): Promise<BackupProvider | undefined> {
        const result = await this.db
            .select()
            .from(backupProviders)
            .where(eq(backupProviders.type, type))
            .limit(1);

        return result[0];
    }

    /**
     * 保存或更新某个提供商的配置
     */
    async upsert(type: string, data: Partial<NewBackupProvider>): Promise<BackupProvider> {
        const existing = await this.findByType(type);

        if (existing) {
            await this.db
                .update(backupProviders)
                .set({ ...data, updatedAt: Date.now() })
                .where(eq(backupProviders.type, type));
            const result = await this.findByType(type);
            return result as BackupProvider;
        } else {
            // 需要构造默认参数
            const insertData: NewBackupProvider = {
                type,
                name: data.name || type.toUpperCase(),
                config: data.config || '{}',
                isEnabled: data.isEnabled ?? true,
                autoBackup: data.autoBackup ?? false,
                autoBackupPassword: data.autoBackupPassword || null,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            await this.db.insert(backupProviders).values(insertData);
            const result = await this.findByType(type);
            return result as BackupProvider;
        }
    }
}
