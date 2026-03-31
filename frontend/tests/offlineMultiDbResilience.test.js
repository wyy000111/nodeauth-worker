import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useVaultSyncStore } from '@/features/vault/store/vaultSyncStore.js';
import * as idb from '@/shared/utils/idb.js';

// Mock IndexedDB wrapper
let memoryDb = [];

vi.mock('@/shared/utils/idb.js', () => ({
    getIdbItem: vi.fn().mockImplementation(() => Promise.resolve([...memoryDb])),
    setIdbItem: vi.fn().mockImplementation((key, val) => { memoryDb = val; return Promise.resolve(true); }),
    removeIdbItem: vi.fn().mockImplementation(() => { memoryDb = []; return Promise.resolve(); })
}));

describe('Offline Multi-DB Resilience (Queue & Fallback)', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        memoryDb = [];
        vi.clearAllMocks();
    });

    it('Happy Path: should enqueue CREATE action safely to IndexedDB when offline', async () => {
        const store = useVaultSyncStore();
        await store.clearQueue();

        const payload = { service: 'Google', account: 'test@gmail.com' };
        await store.enqueueAction('create', 'srv-123', payload);

        // Saved locally optimistically to IDB
        expect(store.syncQueue).toHaveLength(1);
        expect(store.syncQueue[0]).toEqual(expect.objectContaining({
            id: 'srv-123',
            type: 'create',
            data: payload
        }));
        expect(idb.setIdbItem).toHaveBeenCalledWith('vault:sync:queue', expect.any(Array));
    });

    it('Edge Case: Multiple operations on the same ID should smartly collapse (Idempotency)', async () => {
        const store = useVaultSyncStore();
        await store.clearQueue();

        await store.enqueueAction('create', 'vlt-1', { service: 'AWS' });
        expect(store.syncQueue).toHaveLength(1);

        // User edits the same item while still offline
        await store.enqueueAction('update', 'vlt-1', { service: 'AWS Prod' });

        // Should collapse into the 'create' action instead of pushing a new update
        expect(store.syncQueue).toHaveLength(1);
        expect(store.syncQueue[0].type).toBe('create');
        expect(store.syncQueue[0].data.service).toBe('AWS Prod');

        // User deletes the item while still offline
        await store.enqueueAction('delete', 'vlt-1', null);

        // The create and delete actions cancel each other out completely
        expect(store.syncQueue).toHaveLength(0);
    });

    it('Edge Case: Repeated Deletes should not duplicate in queue', async () => {
        const store = useVaultSyncStore();
        await store.clearQueue();

        await store.enqueueAction('delete', 'vlt-999', null);
        await store.enqueueAction('delete', 'vlt-999', null);

        expect(store.syncQueue).toHaveLength(1);
        expect(store.syncQueue[0].type).toBe('delete');
    });

    it('Should cleanly clear queue upon successful multi-DB network sync', async () => {
        const store = useVaultSyncStore();
        await store.clearQueue();

        await store.enqueueAction('create', '1', {});

        await store.clearQueue();

        expect(store.syncQueue.length).toBe(0);
        expect(idb.removeIdbItem).toHaveBeenCalledWith('vault:sync:queue');
    });
});
