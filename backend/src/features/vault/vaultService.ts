import { EnvBindings, AppError } from '@/app/config';
import { VaultRepository } from '@/shared/db/repositories/vaultRepository';
import { encryptField, decryptField, batchInsertVaultItems } from '@/shared/db/db';
import { encryptData, decryptData } from '@/shared/utils/crypto';
import { parseOTPAuthURI, validateBase32Secret, buildOTPAuthURI } from '@/shared/utils/totp';
import { sanitizeInput } from '@/shared/utils/common';

export class VaultService {
    private repository: VaultRepository;
    private env: EnvBindings;
    private encryptionKey: string;

    constructor(env: EnvBindings, repository: VaultRepository) {
        this.env = env;
        this.repository = repository;

        if (!env.ENCRYPTION_KEY) {
            throw new AppError('missing_encryption_key', 500);
        }

        this.encryptionKey = env.ENCRYPTION_KEY;
    }

    /**
     * 获取所有账户 (解密)
     */
    async getAllAccounts() {
        const items = await this.repository.findAll();
        return Promise.all(items.map(async (item) => ({
            ...item,
            secret: await decryptField(item.secret, this.encryptionKey) || ''
        })));
    }

    /**
     * 获取分页和搜索条件后的所有账户 (解密)
     */
    async getAccountsPaginated(page: number, limit: number, search: string, category: string = '') {
        const items = await this.repository.findPaginated(page, limit, search, category);
        const totalCount = await this.repository.count(search, category);
        const categoryStats = await this.repository.getCategoryStats();

        const decryptedItems = await Promise.all(items.map(async (item) => ({
            ...item,
            secret: await decryptField(item.secret, this.encryptionKey) || ''
        })));

        return {
            items: decryptedItems,
            totalCount,
            totalPages: Math.ceil(totalCount / limit) || 1,
            categoryStats: categoryStats.map(s => ({
                category: s.category || '',
                count: s.count
            }))
        };
    }

    /**
     * 重新排序账户
     */
    async reorderAccounts(ids: string[]) {
        if (!ids || ids.length === 0) return;

        const maxSort = await this.repository.getMaxSortOrder();

        // 🔢 间距改为 1000：为分数索引预留充足的整数空间
        // 原间距为 1（连续整数），导致分数插入无空间可用
        // 新间距 1000：两个相邻卡片之间可支持 999 次分数插入，无需重新分配
        const baseOrder = Math.max(maxSort, ids.length * 1000) + ids.length * 1000;
        const updates = ids.map((id, index) => ({
            id,
            sortOrder: baseOrder - index * 1000  // 每个位置间距 1000
        }));

        await this.repository.updateSortOrders(updates);
    }

    /**
     * 分数索引：仅移动单个账号到指定排序值
     * 每次拖拽仅触发 1 次 DB UPDATE，替代全量重排
     */
    async moveSingleItem(id: string, sortOrder: number): Promise<void> {
        await this.repository.updateSingleSortOrder(id, sortOrder);
    }

    /**
     * 创建账户
     */
    // normalize a service+account pair for comparison
    private normalizeSignature(service: string, account: string) {
        return `${(service || '').toString().trim().toLowerCase()}:${(account || '').toString().trim().toLowerCase()}`;
    }

    async createAccount(userId: string, data: any) {
        let { service, account, category, secret, digits, period, algorithm } = data;

        if (!service || !account || !secret || !validateBase32Secret(secret)) {
            throw new AppError('invalid_secret_format', 400);
        }

        // 入库清洗
        service = sanitizeInput(service, 50);
        if (typeof account === 'string' && account.includes(':')) {
            account = account.split(':').pop()?.trim() || account;
        }
        account = sanitizeInput(account, 100);
        category = sanitizeInput(category || '', 30);

        // duplicate check (case‑insensitive & trimmed) using repository helper
        const existing = await this.repository.findByServiceAccount(service, account);
        if (existing) {
            throw new AppError('account_exists', 409);
        }

        const normalizedSecret = secret.replace(/\s/g, '').toUpperCase();
        const encryptedSecret = await encryptField(normalizedSecret, this.encryptionKey);
        const maxSort = await this.repository.getMaxSortOrder();

        return await this.repository.create({
            id: crypto.randomUUID(),
            service,
            account,
            category: category || '',
            secret: encryptedSecret,
            algorithm: algorithm || 'SHA1',
            digits: digits || 6,
            period: period || 30,
            sortOrder: maxSort + 1, // Ensure new account is at the top
            createdAt: Date.now(),
            createdBy: userId
        });
    }

    /**
     * 更新账户
     */
    async updateAccount(id: string, data: any) {
        let { service, account, category, secret, digits, period, algorithm } = data;

        if (!service || !account) {
            throw new AppError('missing_service_account', 400);
        }

        // 入库清洗
        service = sanitizeInput(service, 50);
        if (typeof account === 'string' && account.includes(':')) {
            account = account.split(':').pop()?.trim() || account;
        }
        account = sanitizeInput(account, 100);

        // secret 可选：若未传则保留数据库中已有的加密值
        let encryptedSecret: string;
        if (secret !== undefined) {
            if (!validateBase32Secret(secret)) {
                throw new AppError('invalid_secret_format', 400);
            }
            const normalizedSecret = secret.replace(/\s/g, '').toUpperCase();
            encryptedSecret = await encryptField(normalizedSecret, this.encryptionKey);
        } else {
            // 取出现有记录，复用已有加密值
            const existing = await this.repository.findById(id);
            if (!existing) throw new AppError('account_not_found', 404);
            encryptedSecret = existing.secret;
        }

        // 🛡️ Surgical Update: Only update fields that are actually provided in the payload
        const updateFields: any = {
            service,
            account,
            secret: encryptedSecret,
            ...(data.category !== undefined && { category: sanitizeInput(category || '', 30) }),
            ...(algorithm !== undefined && { algorithm }),
            ...(digits !== undefined && { digits }),
            ...(period !== undefined && { period }),
            ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
            ...(data.updatedBy !== undefined && { updatedBy: data.updatedBy }),
        };

        const updated = await this.repository.update(id, updateFields, data.force ? undefined : data.updatedAt);

        if (!updated) {
            // Check if it's a 404 or a 409
            const item = await this.repository.findById(id);
            if (!item) {
                throw new AppError('account_not_found', 404);
            } else {
                // If item exists but update failed, it's a conflict
                throw new AppError('conflict_detected', 409);
            }
        }
        return updated;
    }

    /**
     * 删除账户 (支持冲突校验与强制删除)
     */
    async deleteAccount(id: string, expectedUpdatedAt?: number, force: boolean = false) {
        // 🛡️ 强制删除时跳过时间戳对比
        const success = await this.repository.delete(id, force ? undefined : expectedUpdatedAt);
        if (!success) {
            const item = await this.repository.findById(id);
            if (!item) {
                throw new AppError('account_not_found', 404);
            } else {
                throw new AppError('conflict_detected', 409);
            }
        }
    }

    async batchDeleteAccounts(ids: string[]) {
        if (!ids || ids.length === 0) throw new AppError('no_account_ids', 400);
        const count = await this.repository.batchDelete(ids);
        return { count };
    }

    /**
     * 处理导出
     */
    async exportAccounts(type: string, password?: string) {
        const SECURITY_CONFIG = { MIN_EXPORT_PASSWORD_LENGTH: 5 };
        if (!['encrypted', 'json', '2fas', 'text'].includes(type)) {
            throw new AppError('export_type_invalid', 400);
        }

        if (type === 'encrypted') {
            if (!password || password.length < SECURITY_CONFIG.MIN_EXPORT_PASSWORD_LENGTH) {
                throw new AppError('export_password_length', 400);
            }
        }

        const plainItems = await this.getAllAccounts();

        const timestamp = new Date().toISOString();
        const baseData = { version: "2.0", app: "nodeauth", timestamp };

        if (type === 'encrypted') {
            const exportData = { ...baseData, encrypted: true, accounts: plainItems };
            // 注意：encryptData 已经在 shared/utils/crypto 引入
            const encryptedContent = await encryptData(exportData, password!);
            return {
                data: { ...baseData, encrypted: true, data: encryptedContent, note: "This file is encrypted with your export password. Keep it safe!" },
                isText: false
            };
        } else if (type === 'json') {
            return { data: { ...baseData, encrypted: false, accounts: plainItems }, isText: false };
        } else if (type === '2fas') {
            // 2FAS 导出格式：字段放在 otp 子对象中，尤其是 account/digits/period/algorithm
            const services = plainItems.map(acc => ({
                name: acc.service,
                secret: acc.secret,
                otp: {
                    tokenType: 'TOTP',
                    issuer: acc.service,
                    account: acc.account,
                    digits: acc.digits,
                    period: acc.period,
                    algorithm: (acc.algorithm || 'SHA1').replace('SHA-', 'SHA'),
                    counter: 0,
                },
                order: { position: 0 },
            }));
            return { data: { schemaVersion: 4, appOrigin: 'export', services }, isText: false };
        } else if (type === 'text') {
            const lines = plainItems.map(acc => {
                return buildOTPAuthURI({
                    service: acc.service,
                    account: acc.account,
                    secret: acc.secret,
                    algorithm: acc.algorithm ?? undefined,
                    digits: acc.digits ?? undefined,
                    period: acc.period ?? undefined
                });
            });
            return { data: lines.join('\n'), isText: true };
        }

        throw new AppError('export_type_invalid', 500);
    }

    /**
     * 处理导入
     */
    async importAccounts(userId: string, type: string, content: string, password?: string) {
        if (!content || !type) throw new AppError('missing_content_type', 400);

        if (type === 'encrypted' && !password) {
            throw new AppError('import_password_required', 400);
        }

        let rawAccounts: any[] = [];

        try {
            if (type === 'encrypted') {
                const encryptedFile = JSON.parse(content);
                const decryptedData = await decryptData(encryptedFile.data, password!);
                rawAccounts = decryptedData.accounts || [];
            } else if (type === 'json') {
                const data = JSON.parse(content);
                if (data.accounts) {
                    rawAccounts = data.accounts;
                } else if (Array.isArray(data.secrets)) {
                    rawAccounts = data.secrets.map((item: any) => ({
                        service: item.issuer || item.service || item.name || 'Unknown',
                        account: item.account || item.label || '',
                        secret: item.secret,
                        algorithm: item.algorithm || 'SHA1',
                        digits: item.digits || 6,
                        period: item.period || 30,
                    }));
                } else if (data.app && data.app.includes('nodeauth') && Array.isArray(data.data)) {
                    rawAccounts = data.data;
                } else if (Array.isArray(data)) {
                    rawAccounts = data;
                } else if (data.services) {
                    rawAccounts = data.services.map((s: any) => ({
                        service: s.otp?.issuer || s.name || s.service,
                        account: s.otp?.account || s.account || '',
                        secret: s.secret,
                        algorithm: s.otp?.algorithm || s.algorithm || 'SHA1',
                        digits: s.otp?.digits || s.digits || 6,
                        period: s.otp?.period || s.period || 30,
                    }));
                }
            } else if (type === '2fas') {
                const data = JSON.parse(content);
                if (Array.isArray(data.services)) {
                    rawAccounts = data.services.map((s: any) => ({
                        service: s.otp?.issuer || s.name || s.otp?.issuer || 'Unknown',
                        account: s.otp?.account || s.account || s.username || '',
                        secret: s.secret || '',
                        algorithm: (s.otp?.algorithm || s.algorithm || 'SHA1').toUpperCase(),
                        digits: s.otp?.digits || s.digits || 6,
                        period: s.otp?.period || s.period || 30,
                        category: s.group || s.category || '',
                    }));
                }
            } else if (type === 'text') {
                const lines = content.split('\n').filter((line: string) => line.trim());
                for (const line of lines) {
                    if (line.trim().startsWith('otpauth://')) {
                        const parsed = parseOTPAuthURI(line.trim());
                        if (parsed) rawAccounts.push({
                            service: parsed.issuer, account: parsed.account,
                            secret: parsed.secret, algorithm: parsed.algorithm,
                            digits: parsed.digits, period: parsed.period
                        });
                    }
                }
            } else if (type === 'raw') {
                rawAccounts = JSON.parse(content);
            }
        } catch (e) {
            if (e instanceof AppError) throw e;
            throw new AppError('parse_failed', 400);
        }

        // 获取现有以去重 (使用小写/去空格以避免大小写差异导致重复)
        const existingItems = await this.repository.findAll();
        const existingSet = new Set(existingItems.map((row: any) => this.normalizeSignature(row.service, row.account)));

        const uniqueAccountsToInsert: any[] = [];
        const seenInBatch = new Set<string>();

        let validCount = 0;
        for (const acc of rawAccounts) {
            if (acc.service && acc.account && validateBase32Secret(acc.secret)) {
                // 统一清洗：去掉 account 中可能带有的 Issuer: 前缀
                if (typeof acc.account === 'string' && acc.account.includes(':')) {
                    acc.account = acc.account.split(':').pop()?.trim() || acc.account;
                }

                const signature = this.normalizeSignature(acc.service, acc.account);
                if (!seenInBatch.has(signature)) {
                    validCount++;
                    seenInBatch.add(signature);
                    if (!existingSet.has(signature)) {
                        uniqueAccountsToInsert.push(acc);
                    }
                }
            }
        }

        const maxSortOrder = await this.repository.getMaxSortOrder();
        const insertedCount = await batchInsertVaultItems(this.env.DB, uniqueAccountsToInsert, this.encryptionKey, userId, maxSortOrder);

        return {
            count: insertedCount,
            total: validCount,
            duplicates: validCount - insertedCount
        };
    }

    /**
     * 批量同步离线操作 (Sync Mode)
     */
    async batchSync(userId: string, actions: any[]) {
        const results: any[] = [];

        // 遍历处理每一个动作，收集结果
        for (const action of actions) {
            const { type, id, data } = action;
            try {
                let res: any;
                switch (type) {
                    case 'create':
                        res = await this.createAccount(userId, data);
                        results.push({ success: true, type, id: action.id, serverId: res.id });
                        break;
                    case 'update':
                        try {
                            await this.updateAccount(id, data);
                        } catch (e: any) {
                            if (e.statusCode === 409) {
                                // 🛡️ Idempotent Sync: Compare against current DB state
                                const existing = await this.repository.findById(id);
                                if (existing) {
                                    const sigServer = this.normalizeSignature(existing.service, existing.account);
                                    const sigClient = this.normalizeSignature(data.service, data.account);
                                    // 🛡️ 鲁棒对比：对齐 undefined/null 为空字符串
                                    const categoryServer = existing.category || '';
                                    const categoryClient = data.category || '';

                                    if (sigServer === sigClient && categoryServer === categoryClient) {
                                        // Still success if it's identical
                                    } else {
                                        throw e;
                                    }
                                } else {
                                    throw e;
                                }
                            } else {
                                throw e;
                            }
                        }
                        results.push({ success: true, type, id });
                        break;
                    case 'delete':
                        try {
                            await this.deleteAccount(id, data?.updatedAt, !!data?.force);
                        } catch (e: any) {
                            // 针对删除动作：如果账号本就不存在（可能被其他设备删了），保持幂等，视为成功
                            if (e instanceof AppError && e.statusCode === 404) {
                                // Ignore
                            } else {
                                throw e;
                            }
                        }
                        results.push({ success: true, type, id });
                        break;
                    case 'reorder':
                        if (data && Array.isArray(data.ids)) {
                            await this.reorderAccounts(data.ids);
                        }
                        results.push({ success: true, type, id });
                        break;
                    default:
                        results.push({ success: false, type, id, error: 'unknown_action' });
                }
            } catch (e: any) {
                // 🛡️ Preserve specific error codes: 409 conflict should NOT be masked as sync_error
                const errorCode = e.statusCode === 409 ? 'conflict_detected' : (e.code || 'sync_error');
                results.push({
                    success: false,
                    type,
                    id,
                    error: e.message,
                    code: errorCode
                });
            }
        }

        return results;
    }

}
