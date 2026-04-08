import { eq } from 'drizzle-orm';
import { schemaMetadata, type SchemaMetadata } from '@/shared/db/schema/index';

export class EmergencyRepository {
    private db: any;

    constructor(dbClient: any) {
        this.db = dbClient;
    }

    /**
     * 获取元数据
     */
    async getMetadata(key: string): Promise<string | null> {
        const result = await this.db
            .select()
            .from(schemaMetadata)
            .where(eq(schemaMetadata.key, key))
            .limit(1);

        return result[0]?.value || null;
    }

    /**
     * 设置元数据
     */
    async setMetadata(key: string, value: string): Promise<void> {
        const existing = await this.getMetadata(key);
        if (existing !== null) {
            await this.db
                .update(schemaMetadata)
                .set({ value })
                .where(eq(schemaMetadata.key, key));
        } else {
            await this.db
                .insert(schemaMetadata)
                .values({ key, value });
        }
    }

    /**
     * 检查系统是否已确认初始化 (Emergency 流程)
     */
    async isEmergencyConfirmed(): Promise<boolean> {
        const value = await this.getMetadata('emergency_confirmed');
        return value === '1';
    }

    /**
     * 确认系统初始化 (Emergency 流程)
     */
    async confirmEmergency(): Promise<void> {
        await this.setMetadata('emergency_confirmed', '1');
    }
}
