import { logger } from '@/shared/utils/logger';
import { DbExecutor } from '@/shared/db/executor';
import { transformSqlForDialect } from '@/shared/db/dialects';

/**
 * 迁移条目
 */
interface Migration {
    version: number;
    name: string;
    sqlite: string;
    d1?: string;
    mysql?: string;
    postgres?: string;
}

const MIGRATIONS: Migration[] = [
    {
        version: 1,
        name: 'add_sort_order_to_vault',
        sqlite: `ALTER TABLE vault ADD COLUMN sort_order INTEGER DEFAULT 0;`
    },
    {
        version: 2,
        name: 'add_category_column_to_vault',
        sqlite: `ALTER TABLE vault ADD COLUMN category TEXT;`
    },
    {
        version: 3,
        name: 'create_vault_category_sort_index',
        sqlite: `CREATE INDEX IF NOT EXISTS idx_vault_category_sort ON vault (category, sort_order);`,
        mysql: `CREATE INDEX idx_vault_category_sort ON vault (category(100), sort_order);`
    },
    {
        version: 4,
        name: 'initialize_baseline_indexes',
        sqlite: `
            CREATE INDEX IF NOT EXISTS idx_vault_created_at ON vault(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_vault_service_created_at ON vault(service, created_at DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS vault_service_account_uq ON vault(service, account);
            CREATE INDEX IF NOT EXISTS idx_backup_providers_type ON backup_providers(type);
            CREATE INDEX IF NOT EXISTS idx_backup_telegram_history_provider_id ON backup_telegram_history(provider_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_backup_email_history_provider_id ON backup_email_history(provider_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON auth_passkeys(user_id);
            CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
        `,
        mysql: `
            CREATE INDEX idx_vault_created_at ON vault(created_at DESC);
            CREATE INDEX idx_vault_service_created_at ON vault(service(100), created_at DESC);
            CREATE UNIQUE INDEX vault_service_account_uq ON vault(service(100), account(100));
            CREATE INDEX idx_backup_providers_type ON backup_providers(type(50));
            CREATE INDEX idx_backup_telegram_history_provider_id ON backup_telegram_history(provider_id, created_at DESC);
            CREATE INDEX idx_backup_email_history_provider_id ON backup_email_history(provider_id, created_at DESC);
            CREATE INDEX idx_passkeys_user_id ON auth_passkeys(user_id(100));
            CREATE INDEX idx_rate_limits_expires ON rate_limits(expires_at);
        `
    },
    {
        version: 5,
        name: 'add_auth_sessions_table',
        sqlite: `CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_type TEXT NOT NULL, ip_address TEXT NOT NULL, last_active_at INTEGER NOT NULL, created_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auth_sessions(user_id); CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON auth_sessions(last_active_at DESC);`,
        mysql: `CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_type TEXT NOT NULL, ip_address TEXT NOT NULL, last_active_at INTEGER NOT NULL, created_at INTEGER NOT NULL); CREATE INDEX idx_sessions_user_id ON auth_sessions(user_id(100)); CREATE INDEX idx_sessions_last_active ON auth_sessions(last_active_at DESC);`
    },
    {
        version: 6,
        name: 'add_transports_to_auth_passkeys',
        sqlite: `ALTER TABLE auth_passkeys ADD COLUMN transports TEXT;`
    },
    {
        version: 7,
        name: 'add_device_id_to_sessions',
        sqlite: `ALTER TABLE auth_sessions ADD COLUMN device_id TEXT; CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON auth_sessions(user_id, device_id);`,
        mysql: `ALTER TABLE auth_sessions ADD COLUMN device_id TEXT; CREATE INDEX idx_sessions_device_id ON auth_sessions(user_id(100), device_id(100));`
    },
    {
        version: 8,
        name: 'add_provider_to_sessions',
        sqlite: `ALTER TABLE auth_sessions ADD COLUMN provider TEXT;`
    },
    {
        version: 9,
        name: 'convert_timestamps_to_bigint',
        sqlite: `SELECT 1;`,
        mysql: `
            ALTER TABLE vault MODIFY created_at BIGINT NOT NULL;
            ALTER TABLE vault MODIFY updated_at BIGINT;
            ALTER TABLE vault MODIFY sort_order BIGINT DEFAULT 0;
            ALTER TABLE backup_providers MODIFY created_at BIGINT NOT NULL;
            ALTER TABLE backup_providers MODIFY updated_at BIGINT NOT NULL;
            ALTER TABLE backup_providers MODIFY last_backup_at BIGINT;
            ALTER TABLE backup_telegram_history MODIFY created_at BIGINT NOT NULL;
            ALTER TABLE backup_email_history MODIFY created_at BIGINT NOT NULL;
            ALTER TABLE auth_passkeys MODIFY created_at BIGINT NOT NULL;
            ALTER TABLE auth_passkeys MODIFY last_used_at BIGINT;
            ALTER TABLE auth_passkeys MODIFY counter BIGINT DEFAULT 0;
            ALTER TABLE auth_sessions MODIFY created_at BIGINT NOT NULL;
            ALTER TABLE auth_sessions MODIFY last_active_at BIGINT NOT NULL;
            ALTER TABLE rate_limits MODIFY last_attempt BIGINT;
            ALTER TABLE rate_limits MODIFY expires_at BIGINT;
            ALTER TABLE rate_limits MODIFY attempts BIGINT DEFAULT 0;
        `,
        postgres: `
            ALTER TABLE vault ALTER COLUMN created_at TYPE BIGINT;
            ALTER TABLE vault ALTER COLUMN updated_at TYPE BIGINT;
            ALTER TABLE vault ALTER COLUMN sort_order TYPE BIGINT;
            ALTER TABLE backup_providers ALTER COLUMN created_at TYPE BIGINT;
            ALTER TABLE backup_providers ALTER COLUMN updated_at TYPE BIGINT;
            ALTER TABLE backup_providers ALTER COLUMN last_backup_at TYPE BIGINT;
            ALTER TABLE backup_telegram_history ALTER COLUMN created_at TYPE BIGINT;
            ALTER TABLE backup_email_history ALTER COLUMN created_at TYPE BIGINT;
            ALTER TABLE auth_passkeys ALTER COLUMN created_at TYPE BIGINT;
            ALTER TABLE auth_passkeys ALTER COLUMN last_used_at TYPE BIGINT;
            ALTER TABLE auth_passkeys ALTER COLUMN counter TYPE BIGINT;
            ALTER TABLE auth_sessions ALTER COLUMN created_at TYPE BIGINT;
            ALTER TABLE auth_sessions ALTER COLUMN last_active_at TYPE BIGINT;
            ALTER TABLE rate_limits ALTER COLUMN last_attempt TYPE BIGINT;
            ALTER TABLE rate_limits ALTER COLUMN expires_at TYPE BIGINT;
            ALTER TABLE rate_limits ALTER COLUMN attempts TYPE BIGINT;
        `
    }
];

/**
 * 统一迁移入口：支持多端兼容
 */
export async function migrateDatabase(db: DbExecutor) {
    const engine = db.engine;

    // 1. 确保元数据表存在
    const createMetaTable = transformSqlForDialect(`CREATE TABLE IF NOT EXISTS _schema_metadata (\`key\` TEXT PRIMARY KEY, \`value\` TEXT)`, engine);
    await db.exec(createMetaTable);

    // 2. 获取当前版本
    const queryMeta = transformSqlForDialect("SELECT `value` FROM _schema_metadata WHERE `key` = 'version'", engine);
    const row = await db.prepare(queryMeta).get();
    const currentVersion = row ? parseInt(row.value, 10) : 0;

    const pending = MIGRATIONS.filter(m => m.version > currentVersion).sort((a, b) => a.version - b.version);

    if (pending.length === 0) return;

    logger.info(`[Database] Current engine: ${engine}. version: ${currentVersion}. Migrating to v${pending[pending.length - 1].version}...`);

    for (const m of pending) {
        logger.info(`[Database] Applying v${m.version}: ${m.name}`);
        try {
            // 将复合 SQL 按分号拆分执行
            const engineSql = (m as any)[engine] || m.sqlite;
            const statements = engineSql.split(';').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
            for (const rawSql of statements) {
                const sql = transformSqlForDialect(rawSql, engine);
                await db.exec(sql);
            }
            // 使用插入或替换
            const updateMetaRaw = engine === 'postgres'
                ? 'INSERT INTO _schema_metadata ("key", "value") VALUES (\'version\', ?) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED.value'
                : "REPLACE INTO _schema_metadata (`key`, `value`) VALUES ('version', ?)";

            const updateMeta = transformSqlForDialect(updateMetaRaw, engine);

            await db.prepare(updateMeta).run(m.version.toString());
        } catch (e: any) {
            const msg = e.message?.toLowerCase() || '';
            if (msg.includes('duplicate column') || msg.includes('already exists') || msg.includes('duplicate key')) {
                logger.info(`[Database] Skip existing change in v${m.version}`);
                const updateMetaRaw = engine === 'postgres'
                    ? 'INSERT INTO _schema_metadata ("key", "value") VALUES (\'version\', ?) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED.value'
                    : "REPLACE INTO _schema_metadata (`key`, `value`) VALUES ('version', ?)";
                const updateMeta = transformSqlForDialect(updateMetaRaw, engine);
                await db.prepare(updateMeta).run(m.version.toString());
                continue;
            }
            throw e;
        }
    }
}
