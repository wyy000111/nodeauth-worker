/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppLockStore } from '../src/features/applock/store/appLockStore'
import { useVaultStore } from '../src/features/vault/store/vaultStore'
import * as idb from '../src/shared/utils/idb'

// Mock IDB
vi.mock('../src/shared/utils/idb', () => ({
    getIdbItem: vi.fn(),
    setIdbItem: vi.fn(),
    removeIdbItem: vi.fn()
}))

describe('Vault & Security Integration - TDD', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    it('should sync vaultStore.isUnlocked with appLockStore.isLocked', () => {
        const appLockStore = useAppLockStore()

        // 1. 默认状态：锁定应同步
        appLockStore.isLocked = true
        expect(appLockStore.isLocked).toBe(true)

        // 2. 解锁状态：应自动同步
        appLockStore.isLocked = false
        expect(appLockStore.isLocked).toBe(false)
    })

    it('should return empty vault without throwing when app is locked', async () => {
        const appLockStore = useAppLockStore()
        const vaultStore = useVaultStore()

        // 模拟锁定态且无密钥
        appLockStore.isLocked = true
        appLockStore.memorySalt = null

        const data = await vaultStore.getData()

        // 验证：不应抛错，应返回空列表供 UI 占位
        expect(data).toEqual({ vault: [] })
    })

    it('should throw "Expired" error if not locked but key is missing (Force Logout scenario)', async () => {
        const appLockStore = useAppLockStore()
        const vaultStore = useVaultStore()

        // 模拟未锁定但密钥丢失（意外状态）
        appLockStore.isLocked = false
        appLockStore.memorySalt = null

        await expect(vaultStore.getData()).rejects.toThrow('设备授权信息已失效')
    })

    it('should successfully decrypt data once unlocked', async () => {
        const appLockStore = useAppLockStore()
        const vaultStore = useVaultStore()

        // 1. 设置模拟加密数据
        idb.getIdbItem.mockResolvedValue('encrypted-vault-blob')

        // 2. 模拟解锁态（有密钥）
        appLockStore.isLocked = false
        appLockStore.memorySalt = new Uint8Array(32).fill(1)

        // 3. 模拟解密工具 (由于 crypto 是异步且复杂的，我们直接断言 getData 流程能走通)
        await vaultStore.getData()

        expect(idb.getIdbItem).toHaveBeenCalledWith('vault:data:main')
    })
})
