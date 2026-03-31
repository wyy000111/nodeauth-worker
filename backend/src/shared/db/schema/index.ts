import * as sqliteSchema from './sqlite.js';
import * as mysqlSchema from './mysql.js';
import * as pgSchema from './pg.js';

// Get the engine directly from global or process env
// In Cloudflare Workers, `process.env` is not available, but that's perfectly fine
// because it relies on D1, which defaults to 'sqlite' schema in this proxy wrapper.
const engine = typeof process !== 'undefined' && process.env.DB_ENGINE
    ? process.env.DB_ENGINE.toLowerCase()
    : 'sqlite';

export let vault: typeof sqliteSchema.vault;
export let backupProviders: typeof sqliteSchema.backupProviders;
export let backupTelegramHistory: typeof sqliteSchema.backupTelegramHistory;
export let backupEmailHistory: typeof sqliteSchema.backupEmailHistory;
export let authPasskeys: typeof sqliteSchema.authPasskeys;
export let authSessions: typeof sqliteSchema.authSessions;
export let rateLimits: typeof sqliteSchema.rateLimits;
export let schemaMetadata: typeof sqliteSchema.schemaMetadata;

if (engine === 'mysql') {
    vault = mysqlSchema.vault as any;
    backupProviders = mysqlSchema.backupProviders as any;
    backupTelegramHistory = mysqlSchema.backupTelegramHistory as any;
    backupEmailHistory = mysqlSchema.backupEmailHistory as any;
    authPasskeys = mysqlSchema.authPasskeys as any;
    authSessions = mysqlSchema.authSessions as any;
    rateLimits = mysqlSchema.rateLimits as any;
    schemaMetadata = mysqlSchema.schemaMetadata as any;
} else if (engine === 'postgres' || engine === 'postgresql') {
    vault = pgSchema.vault as any;
    backupProviders = pgSchema.backupProviders as any;
    backupTelegramHistory = pgSchema.backupTelegramHistory as any;
    backupEmailHistory = pgSchema.backupEmailHistory as any;
    authPasskeys = pgSchema.authPasskeys as any;
    authSessions = pgSchema.authSessions as any;
    rateLimits = pgSchema.rateLimits as any;
    schemaMetadata = pgSchema.schemaMetadata as any;
} else {
    vault = sqliteSchema.vault;
    backupProviders = sqliteSchema.backupProviders;
    backupTelegramHistory = sqliteSchema.backupTelegramHistory;
    backupEmailHistory = sqliteSchema.backupEmailHistory;
    authPasskeys = sqliteSchema.authPasskeys;
    authSessions = sqliteSchema.authSessions;
    rateLimits = sqliteSchema.rateLimits;
    schemaMetadata = sqliteSchema.schemaMetadata;
}

// 统一对外导出标准领域对象的 TypeScript 类型 (以 SQLite 为主准星，所有 Engine 结构必须 100% 对齐)
export type VaultItem = typeof sqliteSchema.vault.$inferSelect;
export type NewVaultItem = typeof sqliteSchema.vault.$inferInsert;
export type BackupProvider = typeof sqliteSchema.backupProviders.$inferSelect;
export type NewBackupProvider = typeof sqliteSchema.backupProviders.$inferInsert;
export type BackupTelegramHistory = typeof sqliteSchema.backupTelegramHistory.$inferSelect;
export type NewBackupTelegramHistory = typeof sqliteSchema.backupTelegramHistory.$inferInsert;
export type BackupEmailHistory = typeof sqliteSchema.backupEmailHistory.$inferSelect;
export type NewBackupEmailHistory = typeof sqliteSchema.backupEmailHistory.$inferInsert;
export type RateLimit = typeof sqliteSchema.rateLimits.$inferSelect;
export type NewRateLimit = typeof sqliteSchema.rateLimits.$inferInsert;
export type SchemaMetadata = typeof sqliteSchema.schemaMetadata.$inferSelect;
export type NewSchemaMetadata = typeof sqliteSchema.schemaMetadata.$inferInsert;
export type AuthSession = typeof sqliteSchema.authSessions.$inferSelect;
export type NewAuthSession = typeof sqliteSchema.authSessions.$inferInsert;
