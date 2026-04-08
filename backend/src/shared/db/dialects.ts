import { DbEngine } from '@/shared/db/executor';

/**
 * Transform SQLite SQL to MySQL/Postgres compatible SQL.
 */
export function transformSqlForDialect(sql: string, engine: DbEngine): string {
    if (engine === 'sqlite' || engine === 'd1') return sql;

    let res = sql;

    if (engine === 'mysql') {
        // SQLite -> MySQL
        res = res.replace(/\bINTEGER PRIMARY KEY AUTOINCREMENT\b/gi, 'BIGINT AUTO_INCREMENT PRIMARY KEY');
        res = res.replace(/\bINTEGER\b/gi, 'BIGINT');
        res = res.replace(/\bkey TEXT PRIMARY KEY\b/gi, '`key` VARCHAR(255) PRIMARY KEY');
        res = res.replace(/\bTEXT PRIMARY KEY\b/gi, 'VARCHAR(255) PRIMARY KEY');

        // Fix MySQL TEXT default limitation
        res = res.replace(/\bTEXT\s+DEFAULT\b/gi, 'VARCHAR(255) DEFAULT');
        res = res.replace(/\bBLOB\b/gi, 'LONGBLOB');
        res = res.replace(/\bINSERT OR REPLACE INTO\b/gi, 'REPLACE INTO');

        // MySQL explicitly doesn't support IF NOT EXISTS in CREATE INDEX.
        // We strip it and let migrator's try-catch (duplicate column/index) handle already-existing indexes.
        res = res.replace(/\bCREATE (UNIQUE )?INDEX IF NOT EXISTS\b/gi, 'CREATE $1INDEX');
    }

    if (engine === 'postgres') {
        // SQLite -> Postgres
        res = res.replace(/`/g, '"');
        res = res.replace(/\bINTEGER PRIMARY KEY AUTOINCREMENT\b/gi, 'BIGSERIAL PRIMARY KEY');
        res = res.replace(/\bINTEGER\b/gi, 'BIGINT');
        res = res.replace(/\bTEXT PRIMARY KEY\b/gi, 'VARCHAR(255) PRIMARY KEY');
        res = res.replace(/\bBLOB\b/gi, 'BYTEA');
        res = res.replace(/\bDATETIME\b/gi, 'TIMESTAMP');
        res = res.replace(/\bBOOLEAN DEFAULT (0|1)\b/gi, (match, val) => `BOOLEAN DEFAULT ${val === '1' ? 'TRUE' : 'FALSE'}`);
        res = res.replace(/\bINSERT OR REPLACE INTO\b/gi, 'INSERT INTO');
        res = res.replace(/lower\(([^)]+)\)/gi, '($&)');
    }

    return res;
}
