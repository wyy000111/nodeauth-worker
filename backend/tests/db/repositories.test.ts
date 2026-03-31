import { describe, it, expect, vi } from 'vitest';
import { VaultRepository } from '../../src/shared/db/repositories/vaultRepository.js';

describe('VaultRepository (Multi-DB Drizzle agnostic assertions)', () => {
    it('should map findAll queries terminating with an await correctly (no .run / .execute)', async () => {
        // Mocking Drizzle Query Builder Chain
        const mockOrderBy = vi.fn().mockResolvedValue([{ id: '1', service: 'Test' }]);
        const mockFrom = vi.fn().mockImplementation(() => ({ orderBy: mockOrderBy }));
        const mockSelect = vi.fn().mockImplementation(() => ({ from: mockFrom }));

        const mockDb = { select: mockSelect };
        const repo = new VaultRepository(mockDb);

        const result = await repo.findAll();

        expect(mockSelect).toHaveBeenCalled();
        expect(mockFrom).toHaveBeenCalled();
        expect(mockOrderBy).toHaveBeenCalled();
        expect(result).toEqual([{ id: '1', service: 'Test' }]);
    });

    it('should map delete queries cleanly (no .run / .execute)', async () => {
        const mockWhere = vi.fn().mockResolvedValue({ success: true, count: 1 });
        const mockDelete = vi.fn().mockImplementation(() => ({ where: mockWhere }));
        const mockFindById = vi.fn().mockResolvedValue({ id: 'VLT-A', updatedAt: 1000 });

        const repo = new VaultRepository({ delete: mockDelete });
        repo.findById = mockFindById; // Stub internal dependency

        const result = await repo.delete('VLT-A');

        expect(mockFindById).toHaveBeenCalledWith('VLT-A');
        expect(mockDelete).toHaveBeenCalled();
        expect(mockWhere).toHaveBeenCalled();
        expect(result).toBe(true);
    });

    it('should implement optimistic concurrency properly preventing race conditions', async () => {
        const mockWhere = vi.fn().mockResolvedValue({ success: true, count: 1 });
        const mockSet = vi.fn().mockReturnThis();
        const mockUpdate = vi.fn().mockReturnValue({ set: mockSet, where: mockWhere, returning: vi.fn().mockResolvedValue([]) });

        const mockFindById = vi.fn().mockResolvedValue({ id: 'VLT-A', updatedAt: 5000 }); // Remote has 5000

        const repo = new VaultRepository({ update: mockUpdate });
        repo.findById = mockFindById;

        // Simulate client submitting an outdated expected timestamp
        const result = await repo.update('VLT-A', { service: 'NewName' }, 4000);

        // Update rejected by optimistic locking mechanism
        expect(result).toBeUndefined();
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should seamlessly handle arrays through batch insert operations', async () => {
        const mockValues = vi.fn().mockResolvedValue([{ id: 'mocked' }]);
        const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

        const repo = new VaultRepository({ insert: mockInsert });

        // This exercises the `await this.db.insert().values()` without `.run()` 
        await repo.batchCreate([
            { id: '1', service: 'A', account: '1', secret: 'abc', createdAt: Date.now() },
            { id: '2', service: 'B', account: '2', secret: 'def', createdAt: Date.now() }
        ]);

        expect(mockInsert).toHaveBeenCalled();
        expect(mockValues).toHaveBeenCalledWith(expect.any(Array));
    });
});
