import { defineStore } from 'pinia'
import { ref } from 'vue'
import { backupService } from '@/features/backup/service/backupService'
import { useAppLockStore } from '@/features/applock/store/appLockStore'
import { encryptDataWithPassword, decryptDataWithPassword } from '@/shared/utils/crypto'
import { getIdbItem, setIdbItem } from '@/shared/utils/idb'

export const useBackupStore = defineStore('backup', () => {
    const appLockStore = useAppLockStore()
    const providers = ref([])
    const isLoading = ref(false)
    const revokedProviderIds = ref(new Set())

    // --- 本地加密缓存逻辑 (已从 VaultStore 迁移) ---
    const loadLocalCache = async () => {
        const key = await appLockStore.getDeviceKey()
        if (!key) return []
        const encrypted = await getIdbItem('vault:conf:backups')
        if (!encrypted) return []
        try {
            const decrypted = await decryptDataWithPassword(encrypted, key)
            return decrypted.providers || []
        } catch (e) {
            console.error('[BackupStore] Failed to decrypt local cache:', e)
            return []
        }
    }

    const saveLocalCache = async (providerList) => {
        const key = await appLockStore.getDeviceKey()
        if (!key) return
        const encrypted = await encryptDataWithPassword({ providers: providerList }, key)
        await setIdbItem('vault:conf:backups', encrypted)
    }

    const fetchProviders = async () => {
        isLoading.value = true
        try {
            const res = await backupService.getProviders()
            if (res.success) {
                providers.value = res.providers || []
            }
        } catch (e) {
            console.error('[BackupStore] Failed to fetch providers:', e)
        } finally {
            isLoading.value = false
        }
    }

    const markAsRevoked = (providerId) => {
        revokedProviderIds.value.add(providerId)
    }

    const isRevoked = (providerId) => {
        return revokedProviderIds.value.has(providerId)
    }

    const updateProviderStatus = (providerId, status) => {
        const provider = providers.value.find(p => p.id === providerId)
        if (provider) {
            provider.status = status
            if (status === 'success') {
                revokedProviderIds.value.delete(providerId)
            }
        }
    }

    return {
        providers,
        isLoading,
        revokedProviderIds,
        fetchProviders,
        markAsRevoked,
        isRevoked,
        updateProviderStatus,
        loadLocalCache,
        saveLocalCache
    }
})

