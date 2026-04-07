import { ref, shallowRef, computed, watch, onMounted } from 'vue'
import { useInfiniteQuery, useQueryClient, keepPreviousData } from '@tanstack/vue-query'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { useVaultStore } from '@/features/vault/store/vaultStore'
import { useVaultSyncStore } from '@/features/vault/store/vaultSyncStore'
import { useAppLockStore } from '@/features/applock/store/appLockStore'
import { vaultService } from '@/features/vault/service/vaultService'

/**
 * 管理金库账号的分页列表逻辑 (Refactored & Fully Documented)
 * 
 * 架构设计原理 (Architecture Design Principles):
 * 
 * 1. 乐观 UI 更新 (Optimistic UI):
 *    任何新增、修改或删除操作都会优先存入 syncStore.syncQueue，并在本 Composable 的 
 *    `vault` 计算属性中实时合流渲染，无需等待 API 返回，确保 PWA 离线时的极速响应。
 * 
 * 2. 缓存合流与去重 (Multilevel Merging & Deduplication):
 *    为了解决“新增不置顶”以及“同步完成瞬间产生重影”的顽疾，本逻辑引入了 ID 级别去重。
 *    即便后端数据已返回，只要同步队列中还存在对应的 Create 动作，仍以队列的 Pending 状态为准，
 *    并将其排在数组首位。
 * 
 * 3. 稳健同步流 (Robust Sync Flow):
 *    针对 PWA 环境常见的网络“假在线”情况，本组件通过 `processVaultUpdate` 实现刚性检查，
 *    拒绝在非确定性成功的情况下抹除本地缓存文件，从而彻底根治“返回列表页变空白”的 Bug。
 * 
 * 4. 分页与搜索 (Pagination & Search):
 *    利用 Vue Query 的缓存机制，在切换分类或搜索时保持之前的 UI 状态，通过 
 *    `placeholderData: keepPreviousData` 实现在加载新分页时无闪烁过渡。
 */
export function useVaultList(afterLoadRef = null) {
    const vaultStore = useVaultStore()
    const appLockStore = useAppLockStore()
    const layoutStore = useLayoutStore()
    const syncStore = useVaultSyncStore()

    const queryClient = useQueryClient()

    // 内部状态维护
    const serverVault = shallowRef([]) // 实际从 API 加载或 IndexedDB 恢复的服务器端原始数据
    const searchQuery = ref('')         // 搜索关键词
    const selectedCategory = ref('')    // 当前选中的分类 ID
    const localCategoryStats = ref([])  // 分类统计的本地缓存副本

    /**
     * 计算当前环境下的分页大小
     * 移动端或紧凑模式下会相应调整，以优化滚动性能
     */
    const pageSize = computed(() => {
        const isCompact = layoutStore.appVaultViewMode === 'compact'
        if (layoutStore.isMobile) return isCompact ? 30 : 15
        return isCompact ? 60 : 16
    })

    /**
     * 🔴 核心合流计算属性 (The Merging Engine - Writable)
     * 将服务器数据 (serverVault) 与 离线动作队列 (syncQueue) 完美融合。
     * 支持 setter 以配合 vuedraggable 等排序组件。
     */
    const vault = computed({
        get() {
            const rawList = serverVault.value || []

            // A. 处理已存在的服务器数据：应用[更新]与[删除]的乐观状态
            const processedList = rawList.map(item => {
                const pendingAction = syncStore.syncQueue.find(a => a.id === item.id)
                if (pendingAction) {
                    if (pendingAction.type === 'delete') return null
                    if (pendingAction.type === 'update') return {
                        ...item,
                        ...pendingAction.data,
                        pending: true,
                        status: pendingAction.status // 🛡️ 暴露同步状态（例如 conflict）
                    }
                    return { ...item, pending: true, status: pendingAction.status }
                }
                return item
            }).filter(Boolean)

            // B. 提取本地待同步的[新增]项，并实现【架构级去重】(O(1) 优化)
            const processedIds = new Set(processedList.map(s => s.id))
            const pendingCreates = syncStore.syncQueue
                .filter(a => a.type === 'create')
                .filter(a => !processedIds.has(a.id))
                .map(a => ({
                    ...a.data,
                    id: a.id,
                    pending: true,
                    currentCode: '------',
                    remaining: 30,
                    percentage: 0
                }))

            // C. 结果排序策略：强制 Pending 状态的新号霸占 Index 0
            // 【注意】如果用户执行了拖拽排序，serverVault 的顺序会被 setter 永久改变
            const finalResults = [...pendingCreates, ...processedList]

            // D. 应用前端过滤 (搜索与分类)
            const search = searchQuery.value?.trim().toLowerCase()
            const isAll = selectedCategory.value === ''
            const categoryToMatch = selectedCategory.value === '____UNCATEGORIZED____' ? '' : selectedCategory.value

            return finalResults.filter(item => {
                const searchMatch = !search ||
                    item.service?.toLowerCase().includes(search) ||
                    item.account?.toLowerCase().includes(search)

                // 🔴 修正逻辑：只有在真正的“全部”模式下才忽略分类；“未分类”模式下必须匹配空字符串
                const categoryMatch = isAll || (item.category || '') === categoryToMatch

                return searchMatch && categoryMatch
            })
        },
        set(newList) {
            if (!newList) return

            // 🛡️ 架构锁：允许在过滤/搜索下重排，采用“相对坑位”缝合法 (Scheme A)
            const search = searchQuery.value?.trim().toLowerCase()
            const isSearching = !!search
            const isFiltered = !!selectedCategory.value

            if (!isSearching && !isFiltered) {
                // A. 无过滤状态：直接全量排序
                const newServerOrder = newList
                    .filter(item => !item.id.startsWith('tmp_'))
                    .map(item => serverVault.value.find(s => s.id === item.id))
                    .filter(Boolean)

                if (newServerOrder.length > 0) {
                    serverVault.value = newServerOrder
                }
                return
            }

            // B. 过滤/搜索状态：相对重排逻辑
            // 1. 获取当前视图中对应的原始服务器 ID 列表 (排除新增项)
            const filteredServerIds = newList
                .filter(item => !item.id.startsWith('tmp_'))
                .map(item => item.id)

            if (filteredServerIds.length <= 1) return

            const serverVaultCopy = [...serverVault.value]
            const isAll = selectedCategory.value === ''
            const categoryToMatch = selectedCategory.value === '____UNCATEGORIZED____' ? '' : selectedCategory.value

            // 2. 在全局 serverVault 中找到所有符合当前过滤条件的“坑位”索引
            const originalIndices = []
            const itemMap = new Map(serverVaultCopy.map(item => [item.id, item]))

            for (let i = 0; i < serverVaultCopy.length; i++) {
                const item = serverVaultCopy[i]
                const searchMatch = !isSearching ||
                    item.service?.toLowerCase().includes(search) ||
                    item.account?.toLowerCase().includes(search)
                const categoryMatch = isAll || (item.category || '') === categoryToMatch

                if (searchMatch && categoryMatch) {
                    originalIndices.push(i)
                }
            }

            // 3. 按照展示顺序 newList 的元素 ID，回填到这些原有的索引坑位中
            // 这样能确保：隐藏的账号位置不动，选中的账号在它们原有的相对位置内进行重排
            filteredServerIds.forEach((id, i) => {
                const targetIdxInVault = originalIndices[i]
                if (targetIdxInVault !== undefined && itemMap.has(id)) {
                    serverVaultCopy[targetIdxInVault] = itemMap.get(id)
                }
            })

            serverVault.value = serverVaultCopy
        }
    })

    /**
     * 构建分类统计的可观察对象
     */
    const categoryStats = computed(() => {
        const firstPage = data.value?.pages?.[0]
        const stats = firstPage?.categoryStats || localCategoryStats.value
        if (!stats) return []

        return stats.map(s => ({
            category: s.category || '',
            count: parseInt(s.count || 0, 10),
            id: s.category === '' ? '____UNCATEGORIZED____' : s.category
        })).sort((a, b) => {
            // 优先按数量从多到少排序
            if (b.count !== a.count) return b.count - a.count
            // 数量相同时按字母顺序排序
            return a.category.localeCompare(b.category)
        })
    })

    /**
     * Vue Query 抓取函数
     */
    const fetchVaultPage = async ({ pageParam = 1, queryKey }) => {
        if (appLockStore.isLocked) return { vault: [], pagination: { totalPages: 0 } }

        const search = (queryKey && queryKey.length > 1) ? queryKey[1] : searchQuery.value
        // 严格模式：请求时携带分类限制。注意：如果是“未分类”，则向后端传递特殊 ID 供其识别，而非空字符串（空字符串代表“全部”）
        const category = selectedCategory.value

        return await vaultService.getVault({
            page: pageParam,
            limit: pageSize.value,
            category,
            search
        })
    }

    const {
        data, fetchNextPage, hasNextPage, isFetchingNextPage,
        isLoading, isFetching, isError, refetch
    } = useInfiniteQuery({
        queryKey: ['vault', searchQuery, selectedCategory, computed(() => layoutStore.appVaultViewMode), () => layoutStore.isManualOffline],
        queryFn: fetchVaultPage,
        getNextPageParam: (lastPage) => {
            if (!lastPage || !lastPage.pagination) return undefined
            const { page, totalPages } = lastPage.pagination
            return page < totalPages ? page + 1 : undefined
        },
        enabled: computed(() => !appLockStore.isLocked),
        staleTime: 60 * 1000,
        placeholderData: keepPreviousData,
    })

    /**
     * 🛡️ 稳如泰山的数据更新器 (Safe State Updater)
     * 负责将分页请求到的数组合并入本地响应式 state。
     */
    const processVaultUpdate = async (flatVault, stats, serverTotalItems = 0) => {
        // 只有真的拿到了成功的分页数据，或者确定是离线下的清空意图，才执行更新
        const isExplicitSuccess = flatVault.length > 0 || (!!data.value && !isError.value && !isLoading.value && !isFetching.value)

        // 🚨 黄金法则：禁止在错误态下抹除本地有效缓存
        if (flatVault.length === 0 && serverVault.value.length > 0 && !isExplicitSuccess) {
            console.warn('[useVaultList] Preserving cache: received inconclusive empty update')
            if (stats && stats.length > 0) localCategoryStats.value = stats
            return
        }

        // 🏛️ 架构级修复：服务器顺序优先合并 (Server-Order-First Merge)
        //
        // 旧策略 (Bug根源)：
        //   以 existingMap (旧缓存) 为基，把服务器数据 patch 进去 → 永远不会删除旧项，导致删除不消失；
        //   新增项被追加到旧 Map 末尾，而非服务器返回的首位，导致新增不置顶。
        //
        // 新策略 (正确)：
        //   以服务器返回的 flatVault 为权威顺序和内容 (Source of Truth)，从其中构建新列表；
        //   仅从旧缓存中携带计算属性 (currentCode 等)，不影响数据结构和顺序。
        //   旧缓存中不在服务器响应里的项会被自然丢弃，从而正确反映删除操作。

        // 构建旧缓存的快速查找表（仅用于读取计算属性）
        const existingMap = new Map(serverVault.value.map(s => [s.id, s]))

        // 以服务器数据顺序为基础构建最终列表
        const merged = flatVault.map(newAcc => {
            const existing = existingMap.get(newAcc.id)
            if (existing) {
                const hasParamChange = existing.digits !== newAcc.digits || existing.secret !== newAcc.secret
                // 服务器数据优先，仅保留本地计算出的临时属性
                return {
                    ...existing,
                    ...newAcc,
                    currentCode: hasParamChange ? '------' : existing.currentCode,
                    forceCompute: hasParamChange ? true : existing.forceCompute
                }
            } else {
                // 服务器返回的全新项（含刚创建的账号）
                return { ...newAcc, currentCode: '------', remaining: 30, percentage: 0 }
            }
        })

        serverVault.value = merged
        if (stats && stats.length > 0) localCategoryStats.value = stats

        // 后台持久化到本地 IndexedDB (秒开基石)
        if (!searchQuery.value && !appLockStore.isLocked && flatVault.length > 0) {
            // 🚨 致命缺陷修复：移除 setTimeout，同步执行写入以防止竞争冲突
            try {
                const localData = await vaultStore.getData()
                const existingFullVault = localData?.vault || []

                const cleanSubset = merged.map(({ currentCode, remaining, percentage, color, nextCode, ...raw }) => raw)
                const cleanMap = new Map(cleanSubset.map(s => [s.id, s]))

                // 用现有的最新子集替换掉全量缓存中的对应项，如果不在缓存里则追加
                const nextFullVault = existingFullVault.map(item => {
                    return cleanMap.has(item.id) ? cleanMap.get(item.id) : item
                })

                // 把本页有，但全量里没有的新增项塞回去
                const existingFullIds = new Set(existingFullVault.map(i => i.id))
                cleanSubset.forEach(item => {
                    if (!existingFullIds.has(item.id)) {
                        nextFullVault.push(item)
                    }
                })

                await vaultStore.saveData({ vault: nextFullVault, categoryStats: stats || localCategoryStats.value || [] })

                // 💡 仅在此处更新服务器宣称的总数量，利用 store 枢纽自动对账
                if (serverTotalItems > 0 && !layoutStore.isOffline) {
                    await vaultStore.updateMetadata({ serverTotal: serverTotalItems })
                }
            } catch (e) {
                console.error('[useVaultList] IDB Cache partial sync failed', e)
            }
        }

        // 触发外部 TOTP 计算引擎
        const needsCompute = merged.filter(acc => !acc.currentCode || acc.currentCode === '------')
        if (needsCompute.length > 0 && afterLoadRef?.value) {
            await afterLoadRef.value(needsCompute)
        }
    }

    // 监听分页数据流
    watch(data, (newData) => {
        if (!newData || !newData.pages || newData.pages.length === 0) return

        const allVaultItems = newData.pages.flatMap(p => p?.vault || [])
        const firstPageStats = newData.pages[0]?.categoryStats || []
        const serverTotalItems = newData.pages[0]?.pagination?.totalItems || newData.pages[0]?.total || 0

        processVaultUpdate(allVaultItems, firstPageStats, serverTotalItems)
    }, { immediate: true })

    // 🔓 架构级修复：解锁后自动重刷数据
    watch(() => appLockStore.isLocked, (isLocked) => {
        if (!isLocked) {
            console.log('[useVaultList] App unlocked, refreshing vault...')
            refetch()
        }
    })

    // 错误跌落保护：当网络报错且内存为空时，强行呼叫 IDB 救援
    watch(isError, async (newError) => {

        if (newError && serverVault.value.length === 0) {
            const localData = await vaultStore.getData()
            if (localData?.vault?.length > 0) {
                processVaultUpdate(localData.vault, localData.categoryStats)
            }
        }
    })

    /**
     * 强力缓存加载器 (First-Paint 基石)
     */
    const initCache = async () => {
        if (serverVault.value.length === 0 && vaultStore.hasVault) {
            const localData = await vaultStore.getData()
            if (localData?.vault?.length > 0) {
                processVaultUpdate(localData.vault, localData.categoryStats)
            }
        }
    }

    // 🔴 架构级自动同步引擎 (Reactive Trigger)
    onMounted(async () => {
        await syncStore.initQueue()
        initCache()
    })

    const fetchVault = () => queryClient.invalidateQueries({ queryKey: ['vault'] })

    // 🔴 核心修复：当手动离线模式切换时，必须 **重置** (reset) 而非仅仅 invalidate Vue Query 的分页缓存。
    // 原因：useInfiniteQuery 在 queryKey 不变的情况下，会把离线返回的全量数据追加为新的一页 (pages[N+1])，
    // 而不是清空旧页重新来过。flatMap 拍平所有页后，就同时包含了在线时积累的分页历史和离线全量，造成重复渲染。
    // reset 会清空 pages 数组并强制从第 1 页重新请求，彻底杜绝此问题。
    watch(() => layoutStore.isManualOffline, () => {
        console.log('[useVaultList] Offline mode changed, resetting query cache to prevent duplicate pages...')
        queryClient.resetQueries({ queryKey: ['vault'] })
    })

    // 监测同步队列，一旦有变动且在网络允许且非离线模式的情况下，立即尝试同步
    watch([() => syncStore.hasPendingChanges, () => layoutStore.isOffline], ([hasPending, isOffline], [oldHasPending, wasOffline]) => {
        // 任何形式的离线（物理掉线或主动开启开关）绝不触发同步
        if (isOffline) return

        const offlineToOnline = wasOffline === true
        const newChangesWhileOnline = hasPending && !oldHasPending

        if (offlineToOnline || newChangesWhileOnline) {
            if (hasPending && !syncStore.isSyncing) {
                console.log('[Auto-Sync] Condition met (state transition), triggering sync...')
                vaultService.syncOfflineActions()
                    .then(() => {
                        console.log('[Auto-Sync] Sync complete, fetching latest remote data...')
                        fetchVault()
                    })
                    .catch(e => console.warn('[Auto-Sync] Sync failed:', e))
            } else if (offlineToOnline && !hasPending) {
                // 如果是从离线切回在线且没有任何积压动作，直接发一次无缝查询同步状态
                console.log('[Auto-Sync] Restored online without pending actions, refreshing list...')
                fetchVault()
            }
        }
    }, { immediate: true })

    // 支持移动端后台切回前台的恢复检测
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !layoutStore.isOffline && syncStore.hasPendingChanges && !syncStore.isSyncing) {
                vaultService.syncOfflineActions()
                    .then(() => fetchVault())
                    .catch(e => console.warn('[Auto-Sync] Visibility restore sync failed:', e))
            }
        })
    }

    // 分页加载状态衍生
    const isLoadMoreDisabled = computed(() => !hasNextPage.value || isFetching.value || isError.value)

    // 🔴 核心：计算总项数 (包含服务器计数 + 离线新增)
    const absoluteTotalItems = computed(() => {
        const serverTotal = (categoryStats.value || localCategoryStats.value || []).reduce((sum, s) => sum + parseInt(s.count || 0, 10), 0)
        const pendingTotal = syncStore.syncQueue.filter(a => a.type === 'create').length
        console.log('[Debug-Stats] Server:', serverTotal, 'Pending:', pendingTotal, 'Queue:', JSON.stringify(syncStore.syncQueue))
        return serverTotal + pendingTotal
    })

    return {
        serverVault,
        vault,
        searchQuery,
        selectedCategory,
        categoryStats,
        localCategoryStats,
        isLoading,
        isFetching,
        isFetchingNextPage,
        hasNextPage,
        isError,
        isLoadMoreDisabled,
        absoluteTotalItems,
        fetchVault,
        refetch,
        handleLoadMore: () => { if (!isLoadMoreDisabled.value) fetchNextPage() }
    }
}
