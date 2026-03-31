import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DbFactory } from '../../src/shared/db/factory.js';
import { SqliteExecutor } from '../../src/shared/db/sqliteExecutor.js';
import { MySqlExecutor } from '../../src/shared/db/mySqlExecutor.js';
import { PgExecutor } from '../../src/shared/db/pgExecutor.js';
import fs from 'fs';

describe('DbFactory (Multi-Engine Tests)', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('should create SqliteExecutor by default (Happy Path)', async () => {
        // Mock SQLite path for test
        const testDbDir = './data';
        if (!fs.existsSync(testDbDir)) fs.mkdirSync(testDbDir, { recursive: true });

        const { executor, db } = await DbFactory.create();
        expect(executor).toBeInstanceOf(SqliteExecutor);
        expect(executor.engine).toBe('sqlite');
        expect(db).toBeDefined();
    });

    it('should create MySqlExecutor when DB_ENGINE is mysql', async () => {
        process.env.DB_ENGINE = 'mysql';
        process.env.DB_HOST = 'localhost';
        process.env.DB_PASSWORD = 'pass';

        const { executor } = await DbFactory.create();
        expect(executor).toBeInstanceOf(MySqlExecutor);
        expect(executor.engine).toBe('mysql');
    });

    it('should create PgExecutor when DB_ENGINE is postgres', async () => {
        process.env.DB_ENGINE = 'postgres';
        process.env.DB_HOST = 'localhost';

        const { executor } = await DbFactory.create();
        expect(executor).toBeInstanceOf(PgExecutor);
        expect(executor.engine).toBe('postgres');
    });

    it('should handle variations in case for DB_ENGINE env', async () => {
        process.env.DB_ENGINE = 'MYSQL';
        const { executor } = await DbFactory.create();
        expect(executor.engine).toBe('mysql');
    });

    it('should handle PostgreSQL and Postgres names interchangeably', async () => {
        process.env.DB_ENGINE = 'postgresql';
        const { executor } = await DbFactory.create();
        expect(executor.engine).toBe('postgres');
    });
});
