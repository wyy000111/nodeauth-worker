import { serve } from '@hono/node-server';
import cron from 'node-cron';
import { initializeEnv } from '@/shared/utils/crypto.js';
import app from '@/app/index.js';
import { handleScheduledBackup } from '@/features/backup/backupRoutes.js';
import fs from 'fs';
import path from 'path';
import { migrateDatabase } from '@/shared/db/migrator.js';
import { DbFactory } from '@/shared/db/factory.js';
import { transformSqlForDialect } from '@/shared/db/dialects.js';
import { nodeAssetsFetch } from '@/shared/utils/staticServer.js';

// 0. 核心预初始化：在任何业务逻辑（如数据库工厂）启动前，先解密环境变量
await initializeEnv(process.env);

const logLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();

// 1. Resolve paths
// In Docker, we run from /app, and frontend is at /app/frontend/dist
// The server.js is at /app/backend/dist/server.js
const baseDir = process.cwd(); // Should be /app in Docker
const frontendDistPath = path.resolve(baseDir, 'frontend/dist');
const dataDir = path.resolve(baseDir, 'data');

if (logLevel !== 'error' && logLevel !== 'warn') {
    console.log(`[Docker Server] Base directory: ${baseDir}`);
    console.log(`[Docker Server] Frontend dist path: ${frontendDistPath}`);
}

// 2. Ensure data directory exists and is writable
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

try {
    fs.accessSync(dataDir, fs.constants.W_OK);
} catch (err) {
    console.error(`\n❌ ERROR: Data directory "${dataDir}" is NOT writable!`);
    console.error(`   Please run on your host: sudo chown -R 1000:1000 ./data\n`);
    process.exit(1);
}

// 3. Initialize Database dynamically using factory
const { db, executor } = await DbFactory.create();

// 4. Resilient Initialization Loop (Baseline + Migrations)
let startupComplete = false;
let retries = 30; // Total 60s for container startup

const schemaFile = fs.existsSync(path.join(baseDir, 'schema.sql'))
    ? path.join(baseDir, 'schema.sql')
    : path.join(baseDir, 'backend/schema.sql');

while (!startupComplete && retries > 0) {
    try {
        if (logLevel !== 'error' && logLevel !== 'warn') {
            console.log(`[Database] Attempting initialization (Engine: ${executor.engine}, Retries left: ${retries})...`);
        }

        // Phase 1: Baseline Schema (Create tables if they don't exist)
        if (fs.existsSync(schemaFile)) {
            const rawSchemaSql = fs.readFileSync(schemaFile, 'utf-8');
            const statements = rawSchemaSql.split(';').map(s => s.trim()).filter(s => s.length > 0);

            for (const rawSql of statements) {
                const sql = transformSqlForDialect(rawSql, executor.engine);
                try {
                    await executor.exec(sql);
                } catch (e: any) {
                    // Ignore "already exists", but let serious errors bubble up to retry
                    if (!e.message?.includes('already exists') && !e.message?.includes('Duplicate')) {
                        throw e; // Bubble to parent catch for retry
                    }
                }
            }
        }

        // Phase 2: Apply incremental migrations
        await migrateDatabase(executor);

        startupComplete = true;
        if (logLevel !== 'error' && logLevel !== 'warn') {
            console.log(`[Database] Engine: ${executor.engine}. Baseline & Migrations ready.`);
        }
    } catch (e: any) {
        const msg = e.message || '';
        // Retry on typical network/connection errors
        if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND') || msg.includes('EHOSTUNREACH') || msg.includes('Connection') || msg.includes('timeout') || msg.includes('Socket')) {
            console.log(`[Database] Network not ready (${msg}), retrying in 2s...`);
            retries--;
            await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
            console.error('[Database] Critical: Startup failure:', e.message);
            process.exit(1);
        }
    }
}

if (!startupComplete) {
    console.error('[Database] Critical: Initialization failed after all retries.');
    process.exit(1);
}

// 7. Setup environment for Hono
const envTemplate = {
    DB: db,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',
    JWT_SECRET: process.env.JWT_SECRET || '',
    OAUTH_ALLOWED_USERS: process.env.OAUTH_ALLOWED_USERS || '',
    ...process.env
};

// 8. Cron Triggers (Daily at 2 AM)
cron.schedule('0 2 * * *', async () => {
    try {
        if (logLevel !== 'error' && logLevel !== 'warn') {
            console.log('[Cron] Triggering daily backup...');
        }
        await handleScheduledBackup(envTemplate as any);
    } catch (e) {
        console.error('[Cron] Backup failed:', e);
    }
});

// 9. Startup Node.js Server
const port = parseInt(process.env.PORT || '3000', 10);

if (logLevel !== 'error' && logLevel !== 'warn') {
    console.log(`[Docker Server] Starting NodeAuth on port ${port}...`);
}

serve({
    fetch: async (req) => {
        // 1. Check static assets first (Sync/Atomic in staticServer utility)
        const assetResponse = await nodeAssetsFetch(req, { frontendDistPath, logLevel });

        // 2. If it's a file, fallback, or any non-404 result, return it
        if (assetResponse.status !== 404) {
            return assetResponse;
        }

        // 3. Fallback to Hono App
        const env = {
            ...envTemplate,
            ASSETS: { fetch: (r: Request) => nodeAssetsFetch(r, { frontendDistPath, logLevel }) }
        };

        return app.fetch(req, env as any, {
            waitUntil: (p: Promise<any>) => p.catch(console.error)
        } as any);
    },
    port
}, (info) => {
    console.log(`[Docker Server] NodeAuth is ready at http://localhost:${info.port}`);
});
