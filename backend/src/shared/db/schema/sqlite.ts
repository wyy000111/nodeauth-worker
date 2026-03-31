import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// 1. 金库项目表 (Vault Items -> mapped to 'vault' table in D1)
// 注意：唯一索引在 D1 上需手动创建，通过迁移命令运行一次即可。
// 该项目使用 SQLite schema 定义仅描述列，复杂索引/约束由数据库层管理。
export const vault = sqliteTable('vault', {
  id: text('id').primaryKey(), // UUID
  service: text('service').notNull(),
  account: text('account').notNull(),
  category: text('category'),
  secret: text('secret').notNull(), // 加密后的密文
  digits: integer('digits').default(6),
  period: integer('period').default(30),
  algorithm: text('algorithm').default('SHA-1'),
  createdAt: integer('created_at').notNull(),
  createdBy: text('created_by'), // 'username' or 'restore'
  updatedAt: integer('updated_at'),
  updatedBy: text('updated_by'),
  sortOrder: integer('sort_order').default(0),
});

// 2. 备份提供商表 (Backup Providers)
export const backupProviders = sqliteTable('backup_providers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(), // 'webdav' | 's3'
  name: text('name').notNull(),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).default(true),
  config: text('config').notNull(), // 加密后的 JSON 字符串
  autoBackup: integer('auto_backup', { mode: 'boolean' }).default(false),
  autoBackupPassword: text('auto_backup_password'), // 加密后的自动备份密码
  autoBackupRetain: integer('auto_backup_retain').default(30), // 保留备份数，0代表无限
  lastBackupAt: integer('last_backup_at'),
  lastBackupStatus: text('last_backup_status'), // 'success' | 'failed'
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// 3. Telegram 备份历史记录表
export const backupTelegramHistory = sqliteTable('backup_telegram_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  providerId: integer('provider_id').notNull(),
  filename: text('filename').notNull(),
  fileId: text('file_id').notNull(),
  messageId: integer('message_id').notNull(),
  size: integer('size').notNull(),
  createdAt: integer('created_at').notNull(),
});

// 5. Email 备份历史记录表
export const backupEmailHistory = sqliteTable('backup_email_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  providerId: integer('provider_id').notNull(),
  filename: text('filename').notNull(),
  recipient: text('recipient').notNull(), // 收件人邮箱地址
  size: integer('size').notNull(),
  createdAt: integer('created_at').notNull(),
});

// 4. 通行密钥表 (Passkeys)
export const authPasskeys = sqliteTable('auth_passkeys', {
  credentialId: text('credential_id').primaryKey(), // 唯一凭据 ID
  userId: text('user_id').notNull(),                // 在本应用中绑定的是邮箱
  name: text('name'),                               // 别名
  publicKey: text('public_key').notNull(),          // Uint8Array 序列化后的数组
  counter: integer('counter').default(0),           // 认证流计算器
  lastUsedAt: integer('last_used_at'),              // 最后一次使用的时间戳
  transports: text('transports'),                   // 传输方式 (JSON 字符串)
  createdAt: integer('created_at').notNull(),
});

// 7. 设备会话表 (Auth Sessions)
export const authSessions = sqliteTable('auth_sessions', {
  id: text('id').primaryKey(), // Session UUID
  userId: text('user_id').notNull(),
  deviceId: text('device_id'), // 物理设备指纹 (Hardware Fingerprint)
  provider: text('provider'),  // 登录方式 (github, passkey, web3 etc.)
  deviceType: text('device_type').notNull(), // User-Agent 解析简述或 'Unknown Device'
  ipAddress: text('ip_address').notNull(),
  lastActiveAt: integer('last_active_at').notNull(),
  createdAt: integer('created_at').notNull(),
});

// 5. 速率限制表 (Rate Limits)
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').default(0),
  lastAttempt: integer('last_attempt'),
  expiresAt: integer('expires_at'),
});

// 6. 架构元数据表 (Metadata)
export const schemaMetadata = sqliteTable('_schema_metadata', {
  key: text('key').primaryKey(),
  value: text('value'),
});

// 导出类型定义
export type VaultItem = typeof vault.$inferSelect;
export type NewVaultItem = typeof vault.$inferInsert;
export type BackupProvider = typeof backupProviders.$inferSelect;
export type NewBackupProvider = typeof backupProviders.$inferInsert;
export type BackupTelegramHistory = typeof backupTelegramHistory.$inferSelect;
export type NewBackupTelegramHistory = typeof backupTelegramHistory.$inferInsert;
export type BackupEmailHistory = typeof backupEmailHistory.$inferSelect;
export type NewBackupEmailHistory = typeof backupEmailHistory.$inferInsert;
export type RateLimit = typeof rateLimits.$inferSelect;
export type NewRateLimit = typeof rateLimits.$inferInsert;
export type SchemaMetadata = typeof schemaMetadata.$inferSelect;
export type NewSchemaMetadata = typeof schemaMetadata.$inferInsert;
export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
