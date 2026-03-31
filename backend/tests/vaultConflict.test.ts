import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultService } from '@/features/vault/vaultService';
import { VaultRepository } from '@/shared/db/repositories/vaultRepository';

/**
 * Vault Conflict Resolution - Backend Red Phase Tests
 */

describe('Vault Conflict Resolution [Backend Red Phase]', () => {
    let service: VaultService;
    let repo: VaultRepository;
    const mockDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() };

    beforeEach(() => {
        vi.clearAllMocks();
        repo = new VaultRepository(mockDb);
        service = new VaultService({ ENCRYPTION_KEY: 'test-key' } as any, repo);
    });

    /**
     * EC_1: 版本冲突拦截 (Stale Update)
     */
    it('EC_1: should throw conflict error if client updatedAt is older than server', async () => {
        const existingAccount = {
            id: 'acc_1',
            service: 'Old',
            account: 'user',
            secret: 'ENC',
            updatedAt: 1005 // Server is at 1005
        };

        vi.spyOn(repo, 'findById').mockResolvedValue(existingAccount as any);

        // Client sends 1000. Must include service and account as they are required by validation
        const updateData = { service: 'New', account: 'user', updatedAt: 1000 };

        await expect(service.updateAccount('acc_1', updateData))
            .rejects
            .toThrow(/conflict_detected|stale_update/);
    });

    /**
     * EC_3: 删除已更新项 (Delete Stale)
     */
    it('EC_3: should prevent direct deletion if record was updated in between', async () => {
        const existingAccount = {
            id: 'acc_1',
            updatedAt: 1005
        };

        vi.spyOn(repo, 'findById').mockResolvedValue(existingAccount as any);

        // Service.deleteAccount now supports timestamp check
        await expect(service.deleteAccount('acc_1', 1000))
            .rejects
            .toThrow(/conflict_detected/);
    });

    /**
     * HP_5: 幂等性处理 (Idempotent Sync)
     * 同步请求重发时，如果内容一样，即便时间戳对不上也不报错。
     */
    it('HP_5: should be idempotent if content is identical despite timestamp mismatch', async () => {
        const existingAccount = {
            id: 'acc_1',
            service: 'Already Updated',
            account: 'user',
            secret: 'ENC_SECRET',
            updatedAt: 1200
        };

        vi.spyOn(repo, 'findById').mockResolvedValue(existingAccount as any);
        // Spy on repository helper instead of trying to mock it with vi.mocked if it's not a mock
        vi.spyOn(repo, 'update').mockResolvedValue(existingAccount as any);


        const sameData = {
            id: 'acc_1',
            service: 'Already Updated',
            account: 'user',
            secret: 'JBSWY3DPEHPK3PXP', // Valid Base32
            updatedAt: 1000
        };

        const result = await service.batchSync('user1', [{ type: 'update', id: 'acc_1', data: sameData }]);

        expect(result[0].success).toBe(true);
    });

    /**
     * TDD: Force Sync Implementation (Green Phase Verification)
     */
    it('should allow update when force: true even if updatedAt mismatched', async () => {
        const id = 'force-update-test';
        const existing = { id, userId: 'user1', service: 'Old', account: 'old', secret: 'S', updatedAt: 2000 };
        vi.spyOn(repo, 'findById').mockResolvedValue(existing as any);
        const updateSpy = vi.spyOn(repo, 'update').mockResolvedValue(true as any);

        await service.updateAccount(id, {
            service: 'Forced Service',
            account: 'forced@test.com',
            updatedAt: 1000,
            force: true
        });

        // 🛡️ Verify that repository.update was called WITH undefined (bypassing the check)
        expect(updateSpy).toHaveBeenCalledWith(id, expect.any(Object), undefined);
    });

    it('should allow delete when force: true even if updatedAt mismatched', async () => {
        const id = 'force-delete-test';
        const deleteSpy = vi.spyOn(repo, 'delete').mockResolvedValue(true);

        await service.deleteAccount(id, 500, true);

        // 🛡️ Verify that repository.delete was called WITH undefined (bypassing the check)
        expect(deleteSpy).toHaveBeenCalledWith(id, undefined);
    });

    it('should still return 404 when force: true but account id not found', async () => {
        const id = 'non-existent-id';
        vi.spyOn(repo, 'findById').mockResolvedValue(null as any);

        await expect(service.updateAccount(id, { service: 'S', account: 'A', force: true }))
            .rejects.toThrow('account_not_found');
    });

    it('batchSync should pass force flag correctly', async () => {
        const id = 'batch-force-test';
        const existing = { id, updatedAt: 2000 };
        vi.spyOn(repo, 'findById').mockResolvedValue(existing as any);
        const updateSpy = vi.spyOn(repo, 'update').mockResolvedValue(true as any);

        const result = await service.batchSync('user1', [{
            type: 'update',
            id,
            data: { service: 'New', account: 'new', updatedAt: 1000, force: true }
        }]);

        expect(result[0].success).toBe(true);
        expect(updateSpy).toHaveBeenCalledWith(id, expect.any(Object), undefined);
    });
});
