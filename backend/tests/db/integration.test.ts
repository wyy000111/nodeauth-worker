import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DbFactory } from '../../src/shared/db/factory.js';
import { migrateDatabase } from '../../src/shared/db/migrator.js';
import { transformSqlForDialect } from '../../src/shared/db/dialects.js';
import { SqliteExecutor } from '../../src/shared/db/sqliteExecutor.js';

describe('Database Integration & Safety (Edge Cases)', () => {

    beforeEach(() => {
        vi.resetModules();
        process.env.DB_ENGINE = 'sqlite';
    });

    it('should fallback to sqlite if DB_ENGINE is invalid (Edge Case 6)', async () => {
        process.env.DB_ENGINE = 'unsupported_db';
        const { executor } = await DbFactory.create();
        expect(executor.engine).toBe('sqlite');
        expect(executor).toBeInstanceOf(SqliteExecutor);
    });

    it('should handle SQL dialect conversion error boundaries (Edge Case 2/3)', () => {
        // SQL 注入与特殊字符测试
        const maliciousSql = "INSERT INTO vault (id) VALUES ('\'); DROP TABLE vault; --')";
        const transformed = transformSqlForDialect(maliciousSql, 'mysql');
        // 确保转换器不会破坏原始字符串内的转义逻辑，虽然本质靠 prepare 解决
        expect(transformed).toContain("DROP TABLE vault");
    });

    it('should correctly handle versioning metadata in multi-engine (Happy Path 3)', async () => {
        const mockExecutor = {
            engine: 'mysql',
            exec: vi.fn().mockResolvedValue(undefined),
            prepare: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ value: '1' }), // 已是 v1
                run: vi.fn()
            })
        };

        await migrateDatabase(mockExecutor as any);

        // 应该只从 v2 开始迁移，并更新元数据
        const runMock = mockExecutor.prepare('dummy').run;
        expect(runMock).toHaveBeenCalledWith('2');
        expect(runMock).toHaveBeenCalledWith('4');
        expect(runMock).not.toHaveBeenCalledWith('1');
    });

    it('should verify SSL configuration transparency in Factory (Edge Case 7)', async () => {
        process.env.DB_ENGINE = 'mysql';
        process.env.DB_SSL = 'true';
        process.env.DB_HOST = 'remote.host';

        const { executor } = await DbFactory.create();
        // 验证 SSL 对象是否被创建（根据实现逻辑）
        expect((executor as any).pool.pool.config.connectionConfig.ssl).toBeDefined();
    });
});
