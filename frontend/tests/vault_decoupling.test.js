import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppLockStore } from '@/features/applock/store/appLockStore'
import { useVaultStore } from '@/features/vault/store/vaultStore'
import { useBackupStore } from '@/features/backup/store/backupStore'
import { getIdbItem, setIdbItem } from '@/shared/utils/idb'
import { encryptDataWithPassword, decryptDataWithPassword } from '@/shared/utils/crypto'

// Mock dependencies
vi.mock('@/shared/utils/idb', () => ({
    getIdbItem: vi.fn(),
    setIdbItem: vi.fn(),
    removeIdbItem: vi.fn()
}))

vi.mock('@/shared/utils/crypto', () => ({
    encryptDataWithPassword: vi.fn(),
    decryptDataWithPassword: vi.fn()
}))

describe('Vault Decoupling Architecture Refactoring (TDD)', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    describe('HP-01: SecurityStore 基座功能', () => {
        it('应该能从 IDB 正确获取 device_salt', async () => {
            getIdbItem.mockResolvedValue('test-salt-123')
            const appLockStore = useAppLockStore()
            const salt = await appLockStore.getDeviceKey()
            expect(salt).toBe('test-salt-123')
            expect(getIdbItem).toHaveBeenCalledWith('sys:sec:device_salt')
        })
    })

    describe('HP-03 & HP-04: BackupStore 本地加密缓存逻辑', () => {
        it('loadLocalCache 应该调用 SecurityStore 获取密钥并解密数据', async () => {
            getIdbItem.mockImplementation((key) => {
                if (key === 'sys:sec:device_salt') return 'test-salt'
                if (key === 'vault:conf:backups') return 'encrypted-data'
                return null
            })
            decryptDataWithPassword.mockResolvedValue({ providers: [{ id: 1, name: 'S3' }] })

            const backupStore = useBackupStore()
            // 确保方法存在 (Red 阶段会在这里失败)
            expect(backupStore.loadLocalCache).toBeDefined()

            const providers = await backupStore.loadLocalCache()
            expect(providers).toHaveLength(1)
            expect(providers[0].name).toBe('S3')
            expect(decryptDataWithPassword).toHaveBeenCalledWith('encrypted-data', 'test-salt')
        })

        it('saveLocalCache 应该使用 SecurityStore 密钥加密并存入 IDB', async () => {
            getIdbItem.mockResolvedValue('test-salt')
            encryptDataWithPassword.mockResolvedValue('new-encrypted-data')

            const backupStore = useBackupStore()
            expect(backupStore.saveLocalCache).toBeDefined()

            await backupStore.saveLocalCache([{ id: 2, name: 'WebDAV' }])
            expect(encryptDataWithPassword).toHaveBeenCalledWith({ providers: [{ id: 2, name: 'WebDAV' }] }, 'test-salt')
            expect(setIdbItem).toHaveBeenCalledWith('vault:conf:backups', 'new-encrypted-data')
        })
    })

    describe('EC-03: VaultStore 职责剥离', () => {
        it('VaultStore 不应再包含备份相关的旧方法', () => {
            const vaultStore = useVaultStore()
            expect(vaultStore.getEncryptedBackupProviders).toBeUndefined()
            expect(vaultStore.saveEncryptedBackupProviders).toBeUndefined()
        })
    })

    describe('EC-02: 缓存损坏兜底逻辑', () => {
        it('如果解密失败，BackupStore.loadLocalCache 应返回空列表而非抛错', async () => {
            getIdbItem.mockResolvedValue('some-salt')
            decryptDataWithPassword.mockRejectedValue(new Error('Decryption failed'))

            const backupStore = useBackupStore()
            const providers = await backupStore.loadLocalCache()
            expect(providers).toEqual([])
        })
    })
})
