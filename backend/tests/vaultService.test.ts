import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultService } from '@/features/vault/vaultService';

// 💡 TDD 技巧：显式 Mock 全局依赖
vi.mock('@/shared/utils/crypto', () => ({
    encryptData: vi.fn(),
    decryptData: vi.fn()
}));

// Mock 数据库加密字段包装器
vi.mock('@/shared/db/db', () => ({
    encryptField: vi.fn().mockResolvedValue('{"encrypted":"cipher"}'),
    batchInsertVaultItems: vi.fn(),
    decryptField: vi.fn()
}));

// Mock TOTP 验证逻辑
const { mockValidateBase32 } = vi.hoisted(() => ({
    mockValidateBase32: vi.fn().mockReturnValue(true)
}));

vi.mock('@/shared/utils/totp', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        validateBase32Secret: mockValidateBase32,
        parseOTPAuthURI: actual.parseOTPAuthURI
    };
});

describe('VaultService Integration (Full Coverage)', () => {
    let vaultService: VaultService;
    let mockRepo: any;
    let mockEnv: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockEnv = {
            ENCRYPTION_KEY: 'test-key',
            DB: {}
        };

        mockRepo = {
            findByServiceAccount: vi.fn().mockResolvedValue(null),
            findAll: vi.fn().mockResolvedValue([]),
            findPaginated: vi.fn().mockResolvedValue([]),
            findById: vi.fn().mockResolvedValue(null),
            count: vi.fn().mockResolvedValue(0),
            getCategoryStats: vi.fn().mockResolvedValue([]),
            updateSortOrders: vi.fn(),
            create: vi.fn().mockImplementation((data) => Promise.resolve({ id: crypto.randomUUID(), ...data })),
            update: vi.fn(),
            delete: vi.fn(),
            batchDelete: vi.fn(),
            getMaxSortOrder: vi.fn().mockResolvedValue(10)
        };

        mockValidateBase32.mockReturnValue(true);
        vaultService = new VaultService(mockEnv, mockRepo);
    });

    describe('create & update', () => {
        it('should create an account successfully', async () => {
            const data = { service: 'Github', account: 'test', secret: 'JBSWY3DPEHPK3PXP' };
            const result = await vaultService.createAccount('u1', data);
            expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
        });

        it('should reuse old secret in updateAccount if not provided', async () => {
            const existingItem = { id: 'acc-1', secret: 'OLD_CRYPTO' };
            mockRepo.findById.mockResolvedValue(existingItem);
            mockRepo.update.mockResolvedValue({ id: 'acc-1', service: 'Renamed' });

            await vaultService.updateAccount('acc-1', { service: 'Renamed', account: 'test' });
            // updateAccount 内部逻辑：...(data.category !== undefined && ...)，如果未传，测试中该字段不应存在
            expect(mockRepo.update).toHaveBeenCalledWith('acc-1', expect.objectContaining({
                secret: 'OLD_CRYPTO',
                service: 'Renamed'
            }), undefined); // 验证第三个参数 updatedAt 为 undefined
        });
    });

    describe('import & stats', () => {
        it('should import text format correctly', async () => {
            const content = 'otpauth://totp/Github:test?secret=JBSWY3DPEHPK3PXP';
            const { batchInsertVaultItems } = await import('@/shared/db/db');
            vi.mocked(batchInsertVaultItems).mockResolvedValue(1);

            const result = await vaultService.importAccounts('u1', 'text', content);
            expect(result.count).toBe(1);
            expect(result.total).toBe(1);
        });

        it('should calculate total pages correctly in getAccountsPaginated', async () => {
            mockRepo.count.mockResolvedValue(25);
            mockRepo.findPaginated.mockResolvedValue([]);
            const result = await vaultService.getAccountsPaginated(1, 10, '');
            expect(result.totalPages).toBe(3);
        });
    });

    describe('reorder & delete', () => {
        it('should update sort orders', async () => {
            const ids = ['a', 'b'];
            mockRepo.getMaxSortOrder.mockResolvedValue(100);
            await vaultService.reorderAccounts(ids);
            expect(mockRepo.updateSortOrders).toHaveBeenCalled();
        });

        it('should delete and batch delete correctly', async () => {
            mockRepo.delete.mockResolvedValue(true);
            await vaultService.deleteAccount('1');
            expect(mockRepo.delete).toHaveBeenCalledWith('1', undefined);

            mockRepo.batchDelete.mockResolvedValue(5);
            const res = await vaultService.batchDeleteAccounts(['1', '2']);
            expect(res.count).toBe(5);
        });
    });

    describe('batchSync idempotency', () => {
        it('should return existing serverId when creating a duplicate account in batchSync', async () => {
            const existingId = 'existing-uuid';
            const action = {
                id: 'tmp_1',
                type: 'create',
                data: { service: 'Github', account: 'test', secret: 'ABC' }
            };

            // 模拟仓库层发现已存在该账号
            mockRepo.findByServiceAccount.mockResolvedValue({ id: existingId, service: 'Github', account: 'test' });

            const results = await vaultService.batchSync('u1', [action as any]);

            expect(results[0].success).toBe(true);
            expect(results[0].serverId).toBe(existingId);
            expect(mockRepo.create).not.toHaveBeenCalled();
        });

        it('should create new account when not found in batchSync', async () => {
            const action = {
                id: 'tmp_2',
                type: 'create',
                data: { service: 'NewSite', account: 'user', secret: 'XYZ' }
            };

            mockRepo.findByServiceAccount.mockResolvedValue(null);

            const results = await vaultService.batchSync('u1', [action as any]);

            expect(results[0].success).toBe(true);
            expect(results[0].serverId).toBeDefined();
            expect(mockRepo.create).toHaveBeenCalled();
        });
    });
});
