import { DbExecutor, DbEngine } from './executor';

export class D1Executor implements DbExecutor {
    readonly engine: DbEngine = 'd1';

    constructor(private d1: any) { }

    async exec(sql: string): Promise<void> {
        await this.d1.exec(sql);
    }

    prepare(sql: string) {
        return {
            get: async (...params: any[]) => {
                const stmt = this.d1.prepare(sql).bind(...params);
                return await stmt.first();
            },
            run: async (...params: any[]) => {
                const stmt = this.d1.prepare(sql).bind(...params);
                return await stmt.run();
            }
        };
    }

    async batch(sqls: string[]): Promise<void> {
        const statements = sqls.map(sql => this.d1.prepare(sql));
        await this.d1.batch(statements);
    }
}
