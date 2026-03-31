import { serve } from '@hono/node-server';
import cron from 'node-cron';
import app from '@/app/index.js';
import { handleScheduledBackup } from '@/features/backup/backupRoutes.js';
import fs from 'fs';
import path from 'path';
import { migrateDatabase } from '@/shared/db/migrator.js';
import { DbFactory } from '@/shared/db/factory.js';
import { transformSqlForDialect } from '@/shared/db/dialects.js';

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

// 8. Define the ASSETS.fetch logic for Node.js
// This replaces Cloudflare's ASSETS.fetch
const nodeAssetsFetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    // Ensure we resolve the path relative to frontendDistPath and normalize it
    let filePath = path.resolve(frontendDistPath, url.pathname.slice(1));

    // Security: check that the file is actually inside frontendDistPath
    if (!filePath.startsWith(frontendDistPath)) {
        console.warn(`[Security] Blocked potential path traversal: ${url.pathname}`);
        return new Response('Forbidden', { status: 403 });
    }

    // SPA fallback: if it's a directory or file doesn't exist, serve index.html
    if (url.pathname === '/' || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(frontendDistPath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
        return new Response('Not Found', { status: 404 });
    }

    const content = fs.readFileSync(filePath);

    // Mime types
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.webmanifest': 'application/manifest+json',
        '.wasm': 'application/wasm'
    };

    return new Response(content, {
        headers: {
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=3600'
        }
    });
};

// 8. Cron Triggers
cron.schedule('0 2 * * *', async () => {
    try {
        console.log('[Cron] Triggering daily backup...');
        await handleScheduledBackup(envTemplate as any);
    } catch (e) {
        console.error('[Cron] Backup failed:', e);
    }
});

// 9. Start Server
const port = parseInt(process.env.PORT || '3000', 10);
serve({
    fetch: (req) => {
        const env = {
            ...envTemplate,
            ASSETS: { fetch: nodeAssetsFetch }
        };
        return app.fetch(req, env as any, {
            waitUntil: (p: Promise<any>) => p.catch(console.error)
        } as any);
    },
    port
}, (info) => {
    console.log(`[Docker Server] NodeAuth is running on http://localhost:${info.port}`);
});
