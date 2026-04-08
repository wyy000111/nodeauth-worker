import pkg from 'pg';
const { Pool } = pkg;
import { DbExecutor, DbEngine } from '@/shared/db/executor';

export class PgExecutor implements DbExecutor {
    readonly engine: DbEngine = 'postgres';
    private pool: any;

    constructor(config: any) {
        this.pool = new Pool({
            host: config.host || 'localhost',
            port: config.port || 5432,
            user: config.user || 'postgres',
            password: config.password,
            database: config.database || 'nodeauth',
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
            ssl: config.ssl ? { rejectUnauthorized: false } : undefined
        });
    }

    async exec(sql: string): Promise<void> {
        // Postgres doesn't support ; multiple statements by default in queries?
        // Actually pg.Pool.query(sql) can take multiple if they are plain SQL.
        await this.pool.query(sql);
    }

    prepare(sql: string) {
        // Postgres uses $1, $2 instead of ?
        // We'll need a simple ? to $n converter for pg
        const pgSql = sql.replace(/\?/g, (match, offset, str) => {
            const index = str.slice(0, offset).split('?').length;
            return `$${index}`;
        });

        return {
            get: async (...params: any[]) => {
                const res = await this.pool.query(pgSql, params);
                return res.rows[0];
            },
            run: async (...params: any[]) => {
                const res = await this.pool.query(pgSql, params);
                return res;
            }
        };
    }
}
