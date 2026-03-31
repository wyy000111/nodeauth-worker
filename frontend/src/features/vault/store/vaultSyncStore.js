import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getIdbItem, setIdbItem, removeIdbItem } from '@/shared/utils/idb'

export const useVaultSyncStore = defineStore('vaultSync', () => {
    // 待同步动作队列：[{ id, type: 'update'|'create'|'delete', data, timestamp }]
    const syncQueue = ref([])
    const isSyncing = ref(false)
    const isInitialized = ref(false)

    // --- 初始化与持久化 ---
    const initQueue = async () => {
        if (isInitialized.value) return
        try {
            const saved = await getIdbItem('vault:sync:queue')
            if (saved && Array.isArray(saved)) {
                syncQueue.value = saved
            }
        } finally {
            isInitialized.value = true
        }
    }

    const saveQueue = async () => {
        // ✅ Deep-unwrap Vue Proxy objects before storing in IDB.
        // IDB's structured clone algorithm cannot serialize Proxy wrappers.
        await setIdbItem('vault:sync:queue', JSON.parse(JSON.stringify(syncQueue.value)))
    }

    // --- Getters ---
    const hasPendingChanges = computed(() => syncQueue.value.length > 0)
    const isItemPending = (id) => syncQueue.value.some(action => action.id === id)

    // --- Actions ---
    const enqueueAction = async (type, id, data) => {
        if (!isInitialized.value) await initQueue()
        _processAction(type, id, data)
        await saveQueue()
    }

    const enqueueActions = async (actions) => {
        if (!isInitialized.value) await initQueue()
        for (const action of actions) {
            _processAction(action.type, action.id, action.data)
        }
        await saveQueue()
    }

    const _processAction = (type, id, data) => {
        // 简单合并逻辑：如果对同一个 ID 已经有 Pending 任务
        const existingIndex = syncQueue.value.findIndex(a => a.id === id)

        if (existingIndex > -1) {
            const existing = syncQueue.value[existingIndex]

            // 🛑 核心业务逻辑：动作抵消
            // 情况 A：[离线创建] 后紧接着 [离线删除] -> 动作归零，不产生任何任务
            if (existing.type === 'create' && type === 'delete') {
                syncQueue.value.splice(existingIndex, 1)
                return
            }

            // 情况 B：[离线删除] 后再重复处理 (幂等处理)
            if (existing.type === 'delete' && type === 'delete') {
                return
            }

            // 情况 C：Update 合并
            if (existing.type === 'create' && type === 'update') {
                existing.data = { ...existing.data, ...data }
            } else if (existing.type === 'update' && type === 'update') {
                existing.data = { ...existing.data, ...data }
            } else {
                // 其他覆盖情况
                syncQueue.value[existingIndex] = { id, type, data, timestamp: Date.now() }
            }
        } else {
            // Find existing item's version if possible to set baseline
            const baselineUpdatedAt = data?.updatedAt;
            syncQueue.value.push({
                id,
                type,
                data,
                baselineUpdatedAt, // 关键：记录操作发起时的基准版本
                timestamp: Date.now()
            })
        }
    }

    // --- Global Network Trigger (Architecture Stability) ---
    // Moved from useVaultList to ensure it's active as long as the store exists.
    if (typeof window !== 'undefined') {
        window.addEventListener('online', async () => {
            if (hasPendingChanges.value && navigator.onLine) {
                try {
                    const { vaultService } = await import('@/features/vault/service/vaultService')
                    await vaultService.syncOfflineActions()
                } catch (e) {
                    console.warn('[Sync-Store] Remote trigger failed:', e)
                }
            }
        })
    }


    const clearQueue = async () => {
        syncQueue.value = []
        await removeIdbItem('vault:sync:queue')
    }

    // 默认开启初始化
    initQueue()

    const resolveConflict = async (id, strategy) => {
        const index = syncQueue.value.findIndex(a => a.id === id)
        if (index === -1) return

        if (strategy === 'force') {
            syncQueue.value[index].data.force = true
            syncQueue.value[index].status = 'pending'
        } else if (strategy === 'discard') {
            syncQueue.value.splice(index, 1)
        }
        await saveQueue()
    }

    return {
        syncQueue,
        isSyncing,
        isInitialized,
        hasPendingChanges,
        isItemPending,
        enqueueAction,
        enqueueActions,
        clearQueue,
        initQueue,
        saveQueue,
        resolveConflict
    }
})
