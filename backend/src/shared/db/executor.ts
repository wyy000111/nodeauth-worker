/**
 * Database Engine Types
 */
export type DbEngine = 'sqlite' | 'mysql' | 'postgres' | 'd1';

/**
 * Common Database Executor Interface
 */
export interface DbExecutor {
    engine: DbEngine;
    exec(sql: string): void | Promise<void>;
    prepare(sql: string): {
        get(...params: any[]): any | Promise<any>;
        run(...params: any[]): any | Promise<any>;
    };
    batch?(sqls: string[]): Promise<void>;
}
