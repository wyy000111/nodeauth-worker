import { eq, desc } from 'drizzle-orm';
import { EnvBindings, AppError } from '@/app/config';
import { BackupRepository } from '@/shared/db/repositories/backupRepository';
import { encryptData, decryptData, encryptBackupFile } from '@/shared/utils/crypto';
import { BackupProvider, WebDavProvider, S3Provider, TelegramProvider, GoogleDriveProvider, OneDriveProvider, BaiduNetdiskProvider, DropboxProvider, EmailProvider, GithubProvider } from '@/features/backup/providers';
import { decryptField } from '@/shared/db/db';
import { vault as vaultTable, backupProviders } from '@/shared/db/schema';

export class BackupService {
    private repository: BackupRepository;
    private env: EnvBindings;
    private db: any;

    constructor(env: EnvBindings, lang: string = 'en-US') {
        this.env = env;
        this.db = env.DB;
        this.repository = new BackupRepository(env.DB);
        // Normalize language (simple check: contains 'zh' -> 'zh-CN', else 'en-US')
        this.lang = lang.toLowerCase().includes('zh') ? 'zh-CN' : 'en-US';
    }

    private lang: string;

    private readonly MASK = '******';
    private readonly SENSITIVE_FIELDS: Record<string, string[]> = {
        webdav: ['password'],
        s3: ['secretAccessKey'],
        telegram: ['botToken'],
        gdrive: ['refreshToken'],
        onedrive: ['refreshToken'],
        baidu: ['refreshToken'],
        dropbox: ['refreshToken'],
        email: ['smtpPassword'],
        github: ['token']
    };

    private maskConfigForFrontend(type: string, config: any) {
        const fields = this.SENSITIVE_FIELDS[type];
        if (!fields) return;
        for (const field of fields) {
            if (config[field]) config[field] = this.MASK;
        }
    }

    private mergeMaskedConfig(type: string, incomingConfig: any, currentConfigBase: any) {
        const fields = this.SENSITIVE_FIELDS[type];
        if (!fields) return;
        for (const field of fields) {
            if (incomingConfig[field] === this.MASK || incomingConfig[field] === undefined || incomingConfig[field] === null) {
                incomingConfig[field] = currentConfigBase[field];
            }
        }
    }

    private async generateEncryptedPayload(key: string, backupPassword: string): Promise<string> {
        const vaultResults = await this.db.select().from(vaultTable);
        const accounts = (await Promise.all(vaultResults.map(async (row: any) => {
            const secret = await decryptField(row.secret, key);
            if (!secret) return null;
            return {
                service: row.service,
                account: row.account,
                category: row.category,
                secret: secret,
                digits: row.digits,
                period: row.period
            };
        }))).filter(Boolean);

        const exportPayload = {
            version: "2.0",
            app: "nodeauth",
            encrypted: true,
            timestamp: new Date().toISOString(),
            accounts
        };

        const userEncrypted = await encryptBackupFile(exportPayload, backupPassword);
        return JSON.stringify({ ...exportPayload, data: userEncrypted, accounts: undefined });
    }

    private validateSafeFilename(filename: string) {
        // Limit filenames to expected format and characters to limit exposure and prevent path traversal
        const safePattern = /^nodeauth-backup-(auto|manual|export)-[a-zA-Z0-9.-]+\.json$/;
        if (!safePattern.test(filename) || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            throw new AppError('invalid_filename_detected', 400);
        }
    }

    private async getProvider(type: string, config: any, id?: number): Promise<BackupProvider> {
        let provider: BackupProvider;
        switch (type) {
            case 'webdav':
                provider = new WebDavProvider(config);
                break;
            case 's3':
                provider = new S3Provider(config);
                break;
            case 'telegram':
                provider = new TelegramProvider(config, this.db, id);
                break;
            case 'gdrive':
                provider = new GoogleDriveProvider(config, this.env);
                break;
            case 'onedrive':
                provider = new OneDriveProvider(config, this.env);
                break;
            case 'baidu':
                provider = new BaiduNetdiskProvider(config, this.env);
                break;
            case 'dropbox':
                provider = new DropboxProvider(config, this.env);
                break;
            case 'email':
                provider = new EmailProvider(config, this.db, id, this.lang);
                break;
            case 'github':
                provider = new GithubProvider(config);
                break;
            default:
                throw new AppError('provider_not_found', 400);
        }

        // Inject persistence callback if id is provided
        if (id) {
            const key = this.env.ENCRYPTION_KEY || this.env.JWT_SECRET;
            provider.onConfigUpdate = async (updatedConfig: any) => {
                const encryptedConfig = await this.processConfigForStorage(type, updatedConfig, key);
                await this.db.update(backupProviders).set({
                    config: encryptedConfig,
                    updatedAt: Date.now()
                }).where(eq(backupProviders.id, id));
                console.log(`[BackupService] Auto-updated config for provider ${id} (${type})`);
            };
        }

        return provider;
    }

    private async processConfigForStorage(type: string, config: any, key: string) {
        const processed = { ...config };
        const fields = this.SENSITIVE_FIELDS[type];

        if (fields) {
            for (const field of fields) {
                if (processed[field] && processed[field] !== this.MASK) {
                    processed[field] = await encryptData(processed[field], key);
                }
            }
        }
        return JSON.stringify(processed);
    }

    public async processConfigForUsage(type: string, configStr: string, key: string) {
        const config = JSON.parse(configStr);
        const fields = this.SENSITIVE_FIELDS[type];

        if (fields) {
            for (const field of fields) {
                if (config[field]) {
                    try {
                        config[field] = await decryptData(config[field], key);
                    } catch (e) {
                        // If decryption fails, it might already be plain text or corrupt, keep it or mask it
                        console.error(`[BackupService] Decryption failed for field ${field} in ${type}`);
                    }
                }
            }
        }
        return config;
    }

    async getProvidersList() {
        const results = await this.repository.findAllSettings();
        const key = this.env.ENCRYPTION_KEY || this.env.JWT_SECRET;

        return await Promise.all(results.map(async (row: any) => {
            const config = await this.processConfigForUsage(row.type, row.config, key);
            this.maskConfigForFrontend(row.type, config);

            return {
                ...row,
                config,
                auto_backup: !!row.autoBackup,
                auto_backup_password: !!row.autoBackupPassword,
                auto_backup_retain: row.autoBackupRetain !== null ? row.autoBackupRetain : 30
            };
        }));
    }

    async addProvider(data: any): Promise<number> {
        const { type, name, config, autoBackup, autoBackupPassword, autoBackupRetain } = data;
        if (!type || !name || !config) throw new AppError('missing_fields', 400);

        const key = this.env.ENCRYPTION_KEY || this.env.JWT_SECRET;
        const encryptedConfig = await this.processConfigForStorage(type, config, key);

        let encryptedAutoBackupPwd = null;
        if (autoBackup && autoBackupPassword) {
            if (autoBackupPassword.length < 6) throw new AppError('backup_password_length', 400);
            encryptedAutoBackupPwd = JSON.stringify(await encryptData(autoBackupPassword, key));
        } else if (autoBackup) {
            throw new AppError('backup_password_required', 400);
        }

        await this.db.insert(backupProviders).values({
            type,
            name,
            config: encryptedConfig,
            autoBackup: autoBackup ? true : false,
            autoBackupPassword: encryptedAutoBackupPwd,
            autoBackupRetain: autoBackupRetain !== undefined ? parseInt(autoBackupRetain, 10) : 30,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });

        const _newRecord = await this.db.select({ id: backupProviders.id }).from(backupProviders)
            .where(eq(backupProviders.type, type))
            .orderBy(desc(backupProviders.id))
            .limit(1);
        const newRecord = _newRecord[0];

        return newRecord.id;
    }

    async updateProvider(id: number, data: any) {
        const { name, config, type, autoBackup, autoBackupPassword, autoBackupRetain } = data;
        const key = this.env.ENCRYPTION_KEY || this.env.JWT_SECRET;

        const _currentProvider = await this.db.select().from(backupProviders).where(eq(backupProviders.id, id)).limit(1);
        const currentProvider = _currentProvider[0];
        if (currentProvider) {
            const currentConfigBase = await this.processConfigForUsage(currentProvider.type, currentProvider.config, key);
            this.mergeMaskedConfig(type, config, currentConfigBase);
        }

        const encryptedConfig = await this.processConfigForStorage(type, config, key);

        const _current = await this.db.select({ autoBackupPassword: backupProviders.autoBackupPassword }).from(backupProviders).where(eq(backupProviders.id, id)).limit(1);
        const current = _current[0];

        let finalAutoPwd = current?.autoBackupPassword;
        if (autoBackupPassword) {
            if (autoBackupPassword.length < 6) throw new AppError('backup_password_length', 400);
            finalAutoPwd = JSON.stringify(await encryptData(autoBackupPassword, key));
        } else if (autoBackup && !finalAutoPwd) {
            throw new AppError('backup_password_required', 400);
        }

        await this.db.update(backupProviders).set({
            name,
            config: encryptedConfig,
            autoBackup: autoBackup ? true : false,
            autoBackupPassword: finalAutoPwd,
            autoBackupRetain: autoBackupRetain !== undefined ? parseInt(autoBackupRetain, 10) : 30,
            updatedAt: Date.now()
        }).where(eq(backupProviders.id, id));
    }

    async deleteProvider(id: number) {
        await this.db.delete(backupProviders).where(eq(backupProviders.id, id));
    }

    async testConnection(type: string, config: any, id?: number) {
        const key = this.env.ENCRYPTION_KEY || this.env.JWT_SECRET;

        if (id) {
            const _currentProvider = await this.db.select().from(backupProviders).where(eq(backupProviders.id, id)).limit(1);
            const currentProvider = _currentProvider[0];
            if (currentProvider) {
                const currentConfigBase = await this.processConfigForUsage(currentProvider.type, currentProvider.config, key);
                this.mergeMaskedConfig(type, config, currentConfigBase);
            }
        }

        try {
            const provider = await this.getProvider(type, config, id);
            await provider.testConnection();
        } catch (e: any) {
            if (e.message === 'oauth_token_revoked' || e.message?.includes('oauth_token_revoked')) {
                throw new AppError('oauth_token_revoked', 401);
            }
            throw new AppError(`connection_failed: ${e.message}`, 400);
        }
    }

    async executeManualBackup(id: number, data: any) {
        const { filename, content, password } = data;
        let finalFilename: string;
        let finalContent: string;
        const key = this.env.ENCRYPTION_KEY || this.env.JWT_SECRET;

        if (filename && content) {
            finalFilename = filename;
            finalContent = content;
        } else if (password !== undefined) {
            let backupPassword = password;
            const _providerRow = await this.db.select({ autoBackupPassword: backupProviders.autoBackupPassword }).from(backupProviders).where(eq(backupProviders.id, id)).limit(1);
            const providerRow = _providerRow[0];

            if (password === '') {
                if (!providerRow || !providerRow.autoBackupPassword) {
                    throw new AppError('manual_backup_password_needed', 400);
                }
                backupPassword = await decryptData(JSON.parse(providerRow.autoBackupPassword), key);
            }

            if (!backupPassword || backupPassword.length < 6) {
                throw new AppError('backup_password_length', 400);
            }

            finalFilename = `nodeauth-backup-manual-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            finalContent = await this.generateEncryptedPayload(key, backupPassword);
        } else {
            throw new AppError('missing_fields', 400);
        }

        const _providerRow = await this.db.select().from(backupProviders).where(eq(backupProviders.id, id)).limit(1);
        const providerRow = _providerRow[0];
        if (!providerRow) throw new AppError('provider_not_found', 404);

        const configObj = await this.processConfigForUsage(providerRow.type, providerRow.config, key);
        const provider = await this.getProvider(providerRow.type, configObj, providerRow.id);

        try {
            await provider.uploadBackup(finalFilename, finalContent);
            await this.db.update(backupProviders).set({
                lastBackupAt: Date.now(),
                lastBackupStatus: 'success'
            }).where(eq(backupProviders.id, id));
        } catch (e: any) {
            await this.db.update(backupProviders).set({ lastBackupStatus: 'failed' }).where(eq(backupProviders.id, id));
            if (e.message === 'oauth_token_revoked' || e.message?.includes('oauth_token_revoked')) {
                throw new AppError('oauth_token_revoked', 401);
            }
            throw new AppError(`backup_failed: ${e.message}`, 500);
        }
    }

    async getFiles(id: number) {
        const _providerRow = await this.db.select().from(backupProviders).where(eq(backupProviders.id, id)).limit(1);
        const providerRow = _providerRow[0];
        if (!providerRow) throw new AppError('provider_not_found', 404);

        const key = this.env.ENCRYPTION_KEY || this.env.JWT_SECRET;
        const config = await this.processConfigForUsage(providerRow.type, providerRow.config, key);
        const provider = await this.getProvider(providerRow.type, config, providerRow.id);

        try {
            return await provider.listBackups();
        } catch (e: any) {
            if (e.message === 'oauth_token_revoked' || e.message?.includes('oauth_token_revoked')) {
                throw new AppError('oauth_token_revoked', 401);
            }
            throw e;
        }
    }

    async downloadFile(id: number, filename: string) {
        if (!filename) throw new AppError('filename_required', 400);
        this.validateSafeFilename(filename);

        const _providerRow = await this.db.select().from(backupProviders).where(eq(backupProviders.id, id)).limit(1);
        const providerRow = _providerRow[0];
        if (!providerRow) throw new AppError('provider_not_found', 404);

        const key = this.env.ENCRYPTION_KEY || this.env.JWT_SECRET;
        const config = await this.processConfigForUsage(providerRow.type, providerRow.config, key);
        const provider = await this.getProvider(providerRow.type, config, providerRow.id);

        try {
            return await provider.downloadBackup(filename);
        } catch (e: any) {
            if (e.message === 'oauth_token_revoked' || e.message?.includes('oauth_token_revoked')) {
                throw new AppError('oauth_token_revoked', 401);
            }
            if (e.message === 'email_download_not_supported') {
                throw new AppError('email_download_not_supported', 400);
            }
            throw new AppError(`download_failed: ${e.message}`, 500);
        }
    }

    async deleteFile(id: number, filename: string) {
        if (!filename) throw new AppError('filename_required', 400);
        this.validateSafeFilename(filename);

        const _providerRow = await this.db.select().from(backupProviders).where(eq(backupProviders.id, id)).limit(1);
        const providerRow = _providerRow[0];
        if (!providerRow) throw new AppError('provider_not_found', 404);

        const key = this.env.ENCRYPTION_KEY || this.env.JWT_SECRET;
        const config = await this.processConfigForUsage(providerRow.type, providerRow.config, key);
        const provider = await this.getProvider(providerRow.type, config, providerRow.id);

        try {
            await provider.deleteBackup(filename);
        } catch (e: any) {
            throw new AppError(`delete_failed: ${e.message}`, 500);
        }
    }

    async handleScheduledBackup() {
        console.log('[Backup] Starting scheduled backup...');
        const providers = await this.db.select().from(backupProviders);
        if (!providers || providers.length === 0) {
            console.log('[Backup] No backup providers configured.');
            return;
        }

        const key = this.env.ENCRYPTION_KEY || this.env.JWT_SECRET;
        const filename = `nodeauth-backup-auto-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

        for (const row of providers) {
            if (!row.autoBackup || !row.autoBackupPassword) continue;

            try {
                const backupPassword = await decryptData(JSON.parse(row.autoBackupPassword), key);
                const fileContent = await this.generateEncryptedPayload(key, backupPassword);

                const config = await this.processConfigForUsage(row.type as string, row.config as string, key);
                const provider = await this.getProvider(row.type as string, config, row.id);

                await provider.uploadBackup(filename, fileContent);

                await this.db.update(backupProviders).set({
                    lastBackupAt: Date.now(),
                    lastBackupStatus: 'success'
                }).where(eq(backupProviders.id, row.id));

                console.log(`[Backup] Successfully backed up to ${row.name}`);

                const retainCount = row.autoBackupRetain !== null ? row.autoBackupRetain : 30;
                if (retainCount > 0) {
                    try {
                        const files = await provider.listBackups();
                        const autoFiles = files.filter((f: any) => f.filename.startsWith('nodeauth-backup-auto-'))
                            .sort((a: any, b: any) => b.filename.localeCompare(a.filename));

                        if (autoFiles.length > retainCount) {
                            const filesToDelete = autoFiles.slice(retainCount);
                            for (const fileToDelete of filesToDelete) {
                                try {
                                    await provider.deleteBackup(fileToDelete.filename);
                                    console.log(`[Backup Prune] Deleted old auto-backup: ${fileToDelete.filename}`);
                                } catch (delErr: any) {
                                    console.error(`[Backup Prune] Failed to delete ${fileToDelete.filename}: ${delErr.message}`);
                                }
                            }
                        }
                    } catch (listErr: any) {
                        console.error(`[Backup Prune] Failed to list backups for pruning: ${listErr.message}`);
                    }
                }
            } catch (e: any) {
                console.error(`[Backup] Failed to backup to ${row.name}: ${e.message}`);
                await this.db.update(backupProviders).set({ lastBackupStatus: 'failed' }).where(eq(backupProviders.id, row.id));
            }
        }
    }
}
