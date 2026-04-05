import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { vaultService } from '@/features/vault/service/vaultService'

// Mock Stores
vi.mock('@/features/vault/store/vaultStore', () => ({
    useVaultStore: () => ({
        getData: vi.fn().mockResolvedValue({
            vault: [
                { service: 'Github', account: 'test-user', secret: 'ABC' }
            ]
        })
    })
}))

const mockSyncStore = {
    enqueueAction: vi.fn(),
    enqueueActions: vi.fn()
}

vi.mock('@/features/vault/store/vaultSyncStore', () => ({
    useVaultSyncStore: () => mockSyncStore
}))

vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: () => ({
        isOffline: true
    })
}))

describe('VaultService Offline Deduplication', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    it('should skip enqueuing create action if account already exists locally (offline)', async () => {
        const { useVaultSyncStore } = await import('@/features/vault/store/vaultSyncStore')
        const syncStore = useVaultSyncStore()

        const duplicateData = { service: 'github ', account: ' TEST-USER', secret: 'XYZ' }

        const result = await vaultService.createAccount(duplicateData)

        expect(result.success).toBe(true)
        expect(result.alreadyExists).toBe(true)
        expect(syncStore.enqueueAction).not.toHaveBeenCalled()
    })

    it('should enqueue create action if account is new (offline)', async () => {
        const { useVaultSyncStore } = await import('@/features/vault/store/vaultSyncStore')
        const syncStore = useVaultSyncStore()

        const newData = { service: 'Google', account: 'new-user', secret: 'ABC' }

        const result = await vaultService.createAccount(newData)

        expect(result.success).toBe(true)
        expect(result.pending).toBe(true)
        expect(syncStore.enqueueAction).toHaveBeenCalledWith('create', expect.any(String), newData)
    })

    it('should filter out existing accounts during bulk import (offline)', async () => {
        const { useVaultSyncStore } = await import('@/features/vault/store/vaultSyncStore')
        const syncStore = useVaultSyncStore()

        const importList = [
            { service: 'Github', account: 'test-user', secret: 'OLD' }, // 应该被跳过 (重复)
            { service: 'Gitlab', account: 'new-user', secret: 'NEW' }   // 应该被导入
        ]

        const result = await vaultService.importVault(importList)

        expect(result.success).toBe(true)
        expect(result.count).toBe(1)
        expect(syncStore.enqueueActions).toHaveBeenCalledWith([
            expect.objectContaining({
                type: 'create',
                data: expect.objectContaining({ service: 'Gitlab' })
            })
        ])
    })
})
