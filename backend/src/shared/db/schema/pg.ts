import { pgTable, varchar, integer, boolean, text, serial, bigint } from 'drizzle-orm/pg-core';

export const vault = pgTable('vault', {
    id: varchar('id').primaryKey(),
    service: varchar('service').notNull(),
    account: varchar('account').notNull(),
    category: varchar('category'),
    secret: text('secret').notNull(),
    digits: integer('digits').default(6),
    period: integer('period').default(30),
    algorithm: varchar('algorithm').default('SHA-1'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    createdBy: varchar('created_by'),
    updatedAt: bigint('updated_at', { mode: 'number' }),
    updatedBy: varchar('updated_by'),
    sortOrder: bigint('sort_order', { mode: 'number' }).default(0),
});

export const backupProviders = pgTable('backup_providers', {
    id: serial('id').primaryKey(),
    type: varchar('type').notNull(),
    name: varchar('name').notNull(),
    isEnabled: boolean('is_enabled').default(true),
    config: text('config').notNull(),
    autoBackup: boolean('auto_backup').default(false),
    autoBackupPassword: text('auto_backup_password'),
    autoBackupRetain: integer('auto_backup_retain').default(30),
    lastBackupAt: bigint('last_backup_at', { mode: 'number' }),
    lastBackupStatus: varchar('last_backup_status'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const backupTelegramHistory = pgTable('backup_telegram_history', {
    id: serial('id').primaryKey(),
    providerId: integer('provider_id').notNull(),
    filename: varchar('filename').notNull(),
    fileId: varchar('file_id').notNull(),
    messageId: integer('message_id').notNull(),
    size: integer('size').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const backupEmailHistory = pgTable('backup_email_history', {
    id: serial('id').primaryKey(),
    providerId: integer('provider_id').notNull(),
    filename: varchar('filename').notNull(),
    recipient: varchar('recipient').notNull(),
    size: integer('size').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const authPasskeys = pgTable('auth_passkeys', {
    credentialId: varchar('credential_id').primaryKey(),
    userId: varchar('user_id').notNull(),
    name: varchar('name'),
    publicKey: text('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).default(0),
    lastUsedAt: bigint('last_used_at', { mode: 'number' }),
    transports: text('transports'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const authSessions = pgTable('auth_sessions', {
    id: varchar('id').primaryKey(),
    userId: varchar('user_id').notNull(),
    deviceId: varchar('device_id'),
    provider: varchar('provider'),
    deviceType: varchar('device_type').notNull(),
    ipAddress: varchar('ip_address').notNull(),
    lastActiveAt: bigint('last_active_at', { mode: 'number' }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const rateLimits = pgTable('rate_limits', {
    key: varchar('key').primaryKey(),
    attempts: bigint('attempts', { mode: 'number' }).default(0),
    lastAttempt: bigint('last_attempt', { mode: 'number' }),
    expiresAt: bigint('expires_at', { mode: 'number' }),
});

export const schemaMetadata = pgTable('_schema_metadata', {
    key: varchar('key').primaryKey(),
    value: text('value'),
});
