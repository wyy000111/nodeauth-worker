import { describe, it, expect, vi, beforeEach } from 'vitest'
import { vaultService } from '../src/features/vault/service/vaultService'
import { useLayoutStore } from '../src/features/home/store/layoutStore'
import { useVaultStore } from '../src/features/vault/store/vaultStore'

import { setActivePinia, createPinia } from 'pinia'

vi.mock('../src/features/home/store/layoutStore', () => ({
    useLayoutStore: vi.fn()
}))

vi.mock('../src/features/vault/store/vaultStore', () => ({
    useVaultStore: vi.fn()
}))

vi.mock('../src/features/applock/store/appLockStore', () => ({
    useAppLockStore: vi.fn(() => ({
        getDeviceKey: vi.fn().mockResolvedValue('key-123'),
        isLocked: false
    }))
}))

describe('VaultService Offline Pagination', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    it('should paginate correctly when offline', async () => {
        // mock 100 items
        const mockItems = Array.from({ length: 100 }).map((_, i) => ({ id: `acc_${i}`, service: `Service ${i}` }))

        useLayoutStore.mockReturnValue({
            isManualOffline: true,
            isOffline: true
        })

        useVaultStore.mockReturnValue({
            getData: vi.fn().mockResolvedValue({
                vault: mockItems,
                categoryStats: []
            })
        })

        // Fetch Page 1 (Actually returns full list in offline mode)
        const res1 = await vaultService.getVault({ page: 1, limit: 15 })
        expect(res1.success).toBe(true)
        expect(res1.vault.length).toBe(100)
        expect(res1.vault[0].id).toBe('acc_0')
        expect(res1.pagination).toEqual({
            page: 1,
            limit: 100,
            totalItems: 100,
            totalPages: 1
        })

        // Fetch Page 2 (Still returns full list as per optimization)
        const res2 = await vaultService.getVault({ page: 2, limit: 15 })
        expect(res2.vault.length).toBe(100)
        expect(res2.vault[0].id).toBe('acc_0')
        expect(res2.pagination.page).toBe(1) // Always 1 in full-load mode
        expect(res2.pagination.totalPages).toBe(1)
    })
})
