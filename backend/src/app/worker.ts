import { drizzle } from 'drizzle-orm/d1';
import app from '@/app/index.js';
import * as schema from '@/shared/db/schema/sqlite.js';
import { handleScheduledBackup } from '@/features/backup/backupRoutes.js';
import { migrateDatabase } from '@/shared/db/migrator.js';
import { D1Executor } from '@/shared/db/d1Executor.js';

export default {
    async fetch(request: Request, env: any, ctx: any) {
        // Initialize D1 driver
        const db = drizzle(env.DB, { schema });

        // 自愈性迁移逻辑：使用标准的 D1Executor
        const executor = new D1Executor(env.DB);

        // 生产环境使用 waitUntil 异步执行迁移检查
        ctx.waitUntil(migrateDatabase(executor));

        // Pass specialized DB and env vars to agnostic router
        const specializedEnv = {
            ...env,
            DB: db, // Replace D1 with Drizzle ORM instance
            ASSETS: env.ASSETS // Ensure ASSETS exists
        };

        return app.fetch(request, specializedEnv, ctx);
    },

    // Scheduled Backup trigger via Cloudflare Cron
    async scheduled(event: any, env: any, ctx: any) {
        const db = drizzle(env.DB, { schema });
        const specializedEnv = {
            ...env,
            DB: db
        };
        ctx.waitUntil(handleScheduledBackup(specializedEnv));
    }
};
