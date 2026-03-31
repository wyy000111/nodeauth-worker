import { describe, it, expect } from 'vitest';
import { transformSqlForDialect } from '../../src/shared/db/dialects.js';

describe('SQL Dialect Transformer (Happy Path)', () => {
    it('should keep SQLite SQL unchanged', () => {
        const sql = 'CREATE TABLE test (id INTEGER PRIMARY KEY)';
        expect(transformSqlForDialect(sql, 'sqlite')).toBe(sql);
    });

    it('should convert SQLite AUTOINCREMENT to MySQL correctly', () => {
        const sqliteSql = 'id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT';
        const mysqlSql = transformSqlForDialect(sqliteSql, 'mysql');
        expect(mysqlSql).toContain('INT AUTO_INCREMENT PRIMARY KEY');
        expect(mysqlSql).toContain('name TEXT');
    });

    it('should convert SQLite AUTOINCREMENT to Postgres SERIAL correctly', () => {
        const sqliteSql = 'id INTEGER PRIMARY KEY AUTOINCREMENT';
        const pgSql = transformSqlForDialect(sqliteSql, 'postgres');
        expect(pgSql).toContain('SERIAL PRIMARY KEY');
    });

    it('should convert BLOB to BYTEA for Postgres', () => {
        const sql = 'data BLOB NOT NULL';
        const pgSql = transformSqlForDialect(sql, 'postgres');
        expect(pgSql).toContain('BYTEA NOT NULL');
    });

    it('should handle boolean defaults for Postgres', () => {
        const sql = 'is_enabled BOOLEAN DEFAULT 1, is_active BOOLEAN DEFAULT 0';
        const pgSql = transformSqlForDialect(sql, 'postgres');
        expect(pgSql).toContain('BOOLEAN DEFAULT TRUE');
        expect(pgSql).toContain('BOOLEAN DEFAULT FALSE');
    });
});

describe('SQL Dialect Transformer (Edge Cases)', () => {
    it('should handle case insensitivity in transformations', () => {
        const sql = 'id integer primary key autoincrement';
        const mysqlSql = transformSqlForDialect(sql, 'mysql');
        expect(mysqlSql).toContain('INT AUTO_INCREMENT PRIMARY KEY');
    });

    it('should wrap functional indexes in extra parens for Postgres', () => {
        const sql = 'CREATE INDEX idx ON vault(lower(service))';
        const pgSql = transformSqlForDialect(sql, 'postgres');
        expect(pgSql).toContain('(lower(service))');
    });

    it('should handle table names with keywords similar to target patterns', () => {
        const sql = 'SELECT autoincrement_field FROM table_with_blob';
        const mysqlSql = transformSqlForDialect(sql, 'mysql');
        // pattern INTEGER PRIMARY KEY AUTOINCREMENT is strict enough not to match autoincrement_field
        expect(mysqlSql).toBe(sql);
    });
});
