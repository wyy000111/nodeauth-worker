import { createPool, Pool } from 'mysql2/promise';
import { DbExecutor, DbEngine } from '@/shared/db/executor';

export class MySqlExecutor implements DbExecutor {
    readonly engine: DbEngine = 'mysql';
    private pool: Pool;

    constructor(config: any) {
        this.pool = createPool({
            host: config.host || 'localhost',
            port: config.port || 3306,
            user: config.user || 'root',
            password: config.password,
            database: config.database || 'nodeauth',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
            supportBigNumbers: true,
            bigNumberStrings: false
        });
    }

    async exec(sql: string): Promise<void> {
        await this.pool.query(sql);
    }

    prepare(sql: string) {
        // MySQL uses ? placeholders natively
        return {
            get: async (...params: any[]) => {
                const [rows] = await this.pool.execute(sql, params);
                return (rows as any[])[0];
            },
            run: async (...params: any[]) => {
                const [result] = await this.pool.execute(sql, params);
                return result;
            }
        };
    }
}
