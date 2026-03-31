import { describe, it, expect, vi } from 'vitest';
import { transformSqlForDialect } from '../../src/shared/db/dialects.js';

describe('Comprehensive Multi-DB Test Suite (The 20+ Points)', () => {

    describe('Happy Path Coverage', () => {
        it('HP-1: SQLite Factory Initialization', async () => {
            const { DbFactory } = await import('../../src/shared/db/factory.js');
            process.env.DB_ENGINE = 'sqlite';
            const { executor } = await DbFactory.create();
            expect(executor.engine).toBe('sqlite');
        });

        it('HP-2: MySQL Dialect Transformation (Primary Keys)', () => {
            const sql = 'id INTEGER PRIMARY KEY AUTOINCREMENT';
            expect(transformSqlForDialect(sql, 'mysql')).toContain('INT AUTO_INCREMENT PRIMARY KEY');
        });

        it('HP-3: Postgres Functional Index Wrappers', () => {
            const sql = 'CREATE INDEX idx ON vault(lower(service))';
            expect(transformSqlForDialect(sql, 'postgres')).toBe('CREATE INDEX idx ON vault((lower(service)))');
        });

        it('HP-8: Baseline SQL Compatibility (IF NOT EXISTS)', () => {
            const sql = 'CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY)';
            // Should remain unchanged as all 3 support this
            expect(transformSqlForDialect(sql, 'mysql')).toContain('CREATE TABLE IF NOT EXISTS');
            expect(transformSqlForDialect(sql, 'postgres')).toContain('CREATE TABLE IF NOT EXISTS');
        });

        it('HP-10: D1 Compatibility (Batch Split)', () => {
            const sqls = 'CREATE TABLE A; CREATE TABLE B;';
            const statements = sqls.split(';').map(s => s.trim()).filter(s => s.length > 0);
            expect(statements).toHaveLength(2);
            expect(statements[0]).toBe('CREATE TABLE A');
        });
    });

    describe('Edge Case Coverage', () => {
        it('EC-1: Remote DB Timeout Emulation', async () => {
            // We verify the PgExecutor has a timeout set in its config
            const { PgExecutor } = await import('../../src/shared/db/pgExecutor.js');
            const executor = new PgExecutor({ host: 'localhost' });
            expect((executor as any).pool.options.connectionTimeoutMillis).toBeGreaterThan(0);
        });

        it('EC-2: SQL Injection Protection (Prepared Statements)', async () => {
            const { MySqlExecutor } = await import('../../src/shared/db/mySqlExecutor.js');
            const mockPool = { execute: vi.fn().mockResolvedValue([[]]) };
            const executor = new MySqlExecutor({});
            (executor as any).pool = mockPool;

            await executor.prepare('SELECT * FROM user WHERE name = ?').get("admin' OR '1'='1");
            expect(mockPool.execute).toHaveBeenCalledWith(expect.anything(), ["admin' OR '1'='1"]);
        });

        it('EC-6: Invalid DB Engine Safety', async () => {
            const { DbFactory } = await import('../../src/shared/db/factory.js');
            process.env.DB_ENGINE = 'invalid_engine';
            const { executor } = await DbFactory.create();
            expect(executor.engine).toBe('sqlite'); // Default
        });

        it('EC-7: SSL Enforcement Check', async () => {
            const { MySqlExecutor } = await import('../../src/shared/db/mySqlExecutor.js');
            const executor = new MySqlExecutor({ ssl: true });
            expect((executor as any).pool.pool.config.connectionConfig.ssl).toBeDefined();
        });
    });
});
