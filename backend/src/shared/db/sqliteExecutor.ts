import type { Database } from 'better-sqlite3';
import { DbExecutor, DbEngine } from '@/shared/db/executor';

export class SqliteExecutor implements DbExecutor {
    readonly engine: DbEngine = 'sqlite';

    constructor(private db: Database) { }

    async exec(sql: string): Promise<void> {
        this.db.exec(sql);
    }

    prepare(sql: string) {
        const stmt = this.db.prepare(sql);
        return {
            get: (...params: any[]) => stmt.get(...params),
            run: (...params: any[]) => stmt.run(...params)
        };
    }
}
