import { logger } from '@/shared/utils/logger';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleMysql } from 'drizzle-orm/mysql2';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { SqliteExecutor } from '@/shared/db/sqliteExecutor';
import { MySqlExecutor } from '@/shared/db/mySqlExecutor';
import { PgExecutor } from '@/shared/db/pgExecutor';
import { DbExecutor } from '@/shared/db/executor';
import * as sqliteSchema from '@/shared/db/schema/sqlite';
import * as mysqlSchema from '@/shared/db/schema/mysql';
import * as pgSchema from '@/shared/db/schema/pg';

export interface DbConnection {
    executor: DbExecutor;
    db: any; // Drizzle instance
    schema: any;
}

import fs from 'fs';
import path from 'path';

export class DbFactory {
    static async create(): Promise<DbConnection> {
        const engine = (process.env.DB_ENGINE || 'sqlite').toLowerCase();
        const baseDir = process.cwd();

        switch (engine) {
            // ... (mysql/postgres 保持不变)
            case 'mysql': {
                const config = {
                    host: process.env.DB_HOST,
                    port: parseInt(process.env.DB_PORT || '3306', 10),
                    user: process.env.DB_USER,
                    password: process.env.DB_PASSWORD,
                    database: process.env.DB_NAME,
                    ssl: process.env.DB_SSL === 'true'
                };
                const executor = new MySqlExecutor(config);
                const db = drizzleMysql((executor as any).pool, { schema: mysqlSchema, mode: 'default' });
                return { executor, db, schema: mysqlSchema };
            }
            case 'postgres':
            case 'postgresql': {
                const config = { host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '5432', 10), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl: process.env.DB_SSL === 'true' };
                const executor = new PgExecutor(config);
                const db = drizzlePg((executor as any).pool, { schema: pgSchema });
                return { executor, db, schema: pgSchema };
            }
            case 'sqlite':
            default: {
                const rawPath = (process.env.SQLITE_DB_PATH || './data/nodeauth.db').trim();
                const dbFile = path.isAbsolute(rawPath) ? rawPath : path.resolve(baseDir, rawPath);

                // 审计 1: 打印绝对路径
                logger.info(`[Database] Engine: SQLite. Resolved path: "${dbFile}"`);

                // 审计 2: 探测写权限 (由于 Node 和 SQLite 行为差异，需双重验证)
                try {
                    const testFile = path.join(path.dirname(dbFile), '.write_test');
                    fs.writeFileSync(testFile, 'ok');
                    fs.unlinkSync(testFile);
                    logger.info(`[Database] Write Test PASSED for: "${path.dirname(dbFile)}"`);
                } catch (e: any) {
                    logger.error(`[Database] Write Test FAILED: ${e.message}`);
                }

                const sqlite = new Database(dbFile);
                sqlite.pragma('journal_mode = WAL');
                const executor = new SqliteExecutor(sqlite);
                const db = drizzleSqlite(sqlite, { schema: sqliteSchema });
                return { executor, db, schema: sqliteSchema };
            }
        }
    }
}
