import { request } from '@/shared/utils/request'
import { vaultError } from '@/shared/utils/errors/vaultError'
import { useVaultSyncStore } from '@/features/vault/store/vaultSyncStore'
import { useVaultStore } from '@/features/vault/store/vaultStore'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { parseOtpUri } from '@/shared/utils/totp'

/**
 * 辅助函数：检测是否为网络层错误（如真实断网、超时、Fetch 失败）
 */
const isNetworkError = (e) => {
    return e.isOffline || // 开启系统“离线模式”开关触发的拦截
        e.name === 'TypeError' ||
        e.message?.toLowerCase().includes('fetch') ||
        e.message?.toLowerCase().includes('network') ||
        (typeof navigator !== 'undefined' && !navigator.onLine)
}

/**
 * @typedef {Object} VaultAccount
 * @property {string} [id] - Account ID
 * @property {string} service - Service name
 * @property {string} account - Account identifier
 * @property {string} secret - Base32-encoded TOTP secret
 * @property {string} [category] - Optional category label
 * @property {6|8} [digits] - OTP digit count
 * @property {30|60} [period] - TOTP period in seconds
 * @property {'SHA1'|'SHA256'|'SHA512'} [algorithm] - HMAC algorithm
 */

/**
 * @typedef {Object} VaultPagination
 * @property {number} page - Current page number
 * @property {number} totalPages - Total number of pages
 * @property {number} total - Total item count
 */

/**
 * @typedef {Object} VaultListResponse
 * @property {boolean} success
 * @property {VaultAccount[]} vault - List of accounts for THIS page
 * @property {VaultPagination} pagination
 */

/**
 * 金库账号业务服务层
 */
export const vaultService = {
    /**
     * 获取账号列表
     * @param {Object} options - 分页与过滤选项
     * @param {number} [options.page] - 页码
     * @param {number} [options.limit] - 每页数量
     * @param {string} [options.search] - 搜索关键词
     * @param {string} [options.category] - 分類筛选
     * @returns {Promise<VaultListResponse>} 账号列表分页数据
     * @throws {vaultError} 请求失败时抛出错误
     */
    /**
     * 获取账号列表
     * 双模实现：在线 -> API 分页；离线 -> 本地 IDB 全量解密 + 本地分页/搜索/过滤
     */
    async getVault({ page = 1, limit = 12, search = '', category = '' }) {
        const layoutStore = useLayoutStore()

        if (layoutStore.isManualOffline) {
            // 🛡️ 离线数据路径：直接从 IndexedDB 解密并分页
            try {
                // 🏛️ 使用静态导入（已在文件顶部），避免动态 import() 引起 Vite 代码分割问题
                const vaultStore = useVaultStore()
                const localData = await vaultStore.getData()
                let items = localData?.vault || []

                // 本地搜索过滤
                if (search && search.trim()) {
                    const q = search.trim().toLowerCase()
                    items = items.filter(item =>
                        item.service?.toLowerCase().includes(q) ||
                        item.account?.toLowerCase().includes(q)
                    )
                }

                // 本地分类过滤
                if (category && category !== '____UNCATEGORIZED____') {
                    items = items.filter(item => (item.category || '') === category)
                } else if (category === '____UNCATEGORIZED____') {
                    items = items.filter(item => !item.category || item.category === '')
                }

                // 🏛️ 架构级优化：离线模式下，直接返回全量本地数据 (不再分页)
                // 解决问题：防止 Vue Query 的分页加载与 initCache 缓存策略产生竞争，导致内存数据残留或覆盖。
                const total = items.length
                const totalPages = 1 // 离线模式一次性交卷

                // 本地统计分类 (全量：保持分类列表不因筛选而消失)
                const fullVault = localData?.vault || []
                const categoryMap = {}
                fullVault.forEach(item => {
                    const cat = item.category || ''
                    categoryMap[cat] = (categoryMap[cat] || 0) + 1
                })
                const categoryStats = Object.entries(categoryMap).map(([category, count]) => ({ category, count }))

                return {
                    success: true,
                    vault: items, // 直接返回全量，由 DynamicScroller 处理虚拟渲染性能
                    total,
                    categoryStats,
                    pagination: { page: 1, limit: total, totalItems: total, totalPages }
                }

            } catch (e) {
                console.error('[VaultService] Offline getVault failed:', e)
                throw e
            }
        }

        // ☁️ 在线数据路径：正常 API 请求
        try {
            const params = new URLSearchParams({ page, limit, search, category })
            return await request(`/api/vault?${params.toString()}`)
        } catch (e) {
            throw new vaultError('Failed to fetch vault list', 'VAULT_FETCH_FAILED', e)
        }
    },


    /**
     * 创建新账号
     * @param {VaultAccount} vaultData - 账号数据
     * @returns {Promise<{success: boolean, id: string}>} 创建成功的账号 ID
     * @throws {vaultError} 创建失败时抛出错误
     */
    async createAccount(vaultData) {
        const performOffline = async () => {
            const vaultStore = useVaultStore()
            const syncStore = useVaultSyncStore()
            const localData = await vaultStore.getData()
            const currentVault = localData?.vault || []

            const normalize = (s, a) => `${(s || '').trim().toLowerCase()}:${(a || '').trim().toLowerCase()}`
            const newSig = normalize(vaultData.service, vaultData.account)

            // 🛡️ 根源去重：如果本地已存在该账号，直接返回成功，不产生同步任务
            if (currentVault.some(acc => normalize(acc.service, acc.account) === newSig)) {
                console.warn('[VaultService] Account already exists locally, skipping duplicate create task')
                return { success: true, alreadyExists: true }
            }

            const tempId = `tmp_${Date.now()}`
            syncStore.enqueueAction('create', tempId, vaultData)
            return {
                success: true,
                pending: true,
                item: { ...vaultData, id: tempId, pending: true }
            }
        }

        try {
            const layoutStore = useLayoutStore()
            if (layoutStore.isOffline) return performOffline()

            return await request('/api/vault', {
                method: 'POST',
                body: JSON.stringify(vaultData)
            })
        } catch (e) {
            if (isNetworkError(e)) {
                console.warn('[VaultService] Network error, falling back to offline queue', e)
                return performOffline()
            }
            throw new vaultError('Failed to create account', 'ACCOUNT_CREATE_FAILED', e)
        }
    },

    /**
     * 更新账号信息
     * @param {string} id - 账号唯一标识
     * @param {Partial<VaultAccount>} updateData - 需要更新的字段
     * @returns {Promise<{success: boolean}>} 更新是否成功
     * @throws {vaultError} 更新失败时抛出错误
     */
    async updateAccount(id, updateData) {
        const performOffline = () => {
            const syncStore = useVaultSyncStore()
            syncStore.enqueueAction('update', id, updateData)
            return { success: true, pending: true }
        }

        try {
            const layoutStore = useLayoutStore()
            if (layoutStore.isOffline) return performOffline()

            return await request(`/api/vault/${id}`, {
                method: 'PUT',
                body: JSON.stringify(updateData)
            })
        } catch (e) {
            if (isNetworkError(e)) return performOffline()
            throw new vaultError('Failed to update account', 'ACCOUNT_UPDATE_FAILED', e)
        }
    },

    /**
     * 删除单个账号
     * @param {string} id - 账号唯一标识
     * @returns {Promise<{success: boolean}>} 删除是否成功
     * @throws {vaultError} 删除失败时抛出错误
     */
    async deleteAccount(id, data = {}) {
        const performOffline = () => {
            const syncStore = useVaultSyncStore()
            syncStore.enqueueAction('delete', id, data)
            return { success: true, pending: true }
        }

        try {
            const layoutStore = useLayoutStore()
            if (layoutStore.isOffline) return performOffline()

            return await request(`/api/vault/${id}`, { method: 'DELETE' })
        } catch (e) {
            // 🛡️ 架构级修正：处理后端已删除的情况 (404 idempotent)
            const statusCode = e.details?.statusCode || e.statusCode
            const message = e.details?.message || e.message

            if (statusCode === 404 || message === 'account_not_found') {
                console.warn('[VaultService] Account already deleted on server, treating as success:', id)
                return { success: true }
            }

            if (isNetworkError(e)) return performOffline()
            throw new vaultError('Failed to delete account', 'ACCOUNT_DELETE_FAILED', e)
        }
    },

    /**
     * 批量删除账号
     * @param {string[]} ids - 账号 ID 数组
     * @returns {Promise<{success: boolean, deleted: number}>} 删除是否成功及删除数量
     * @throws {vaultError} 批量删除失败时抛出错误
     */
    async batchDelete(ids) {
        const performOffline = () => {
            const syncStore = useVaultSyncStore()
            for (const id of ids) syncStore.enqueueAction('delete', id)
            return { success: true, pending: true, deleted: ids.length }
        }

        try {
            const layoutStore = useLayoutStore()
            if (layoutStore.isOffline) return performOffline()

            return await request('/api/vault/batch-delete', {
                method: 'POST',
                body: JSON.stringify({ ids })
            })
        } catch (e) {
            if (isNetworkError(e)) return performOffline()
            throw new vaultError('Failed to batch delete accounts', 'ACCOUNTS_BATCH_DELETE_FAILED', e)
        }
    },

    /**
     * 重新排序金库项
     * @param {string[]} ids - 排序后的 ID 数组
     * @returns {Promise<{success: boolean}>} 排序更新是否成功
     * @throws {vaultError} 排序失败时抛出错误
     */
    async reorder(ids) {
        const performOffline = () => {
            const syncStore = useVaultSyncStore()
            syncStore.enqueueAction('reorder', 'global_order', { ids })
            return { success: true, pending: true }
        }

        try {
            const layoutStore = useLayoutStore()
            if (layoutStore.isOffline) return performOffline()

            return await request('/api/vault/reorder', {
                method: 'POST',
                body: JSON.stringify({ ids })
            })
        } catch (e) {
            if (isNetworkError(e)) return performOffline()
            throw new vaultError('Failed to reorder accounts', 'VAULT_REORDER_FAILED', e)
        }
    },

    /**
     * 分数索引：仅发送单个账号的新排序值
     * 每次拖拽仅触发 1 次网络请求 + 1 次 DB UPDATE，替代全量重排
     * 
     * @param {string} id - 被移动的账号 ID
     * @param {number} sortOrder - 分数索引计算出的新排序值
     */
    async moveSortOrder(id, sortOrder) {
        const performOffline = () => {
            const syncStore = useVaultSyncStore()
            // 以 id 为 key 入队，重复拖拽同一张卡片时会自动合并（取最新值）
            syncStore.enqueueAction('move-sort', id, { sortOrder })
            return { success: true, pending: true }
        }

        try {
            const layoutStore = useLayoutStore()
            if (layoutStore.isOffline) return performOffline()

            return await request(`/api/vault/${id}/sort-order`, {
                method: 'PATCH',
                body: JSON.stringify({ sortOrder })
            })
        } catch (e) {
            if (isNetworkError(e)) return performOffline()
            throw new vaultError('Failed to move sort order', 'VAULT_SORT_MOVE_FAILED', e)
        }
    },

    /**
     * 通过扫描生成的 OTP URI 直接添加账号
     * @param {string} uri - OTPAuth URI
     * @param {string} [category] - 指定分类
     * @returns {Promise<{success: boolean, id: string}>} 添加成功的账号数据
     * @throws {vaultError} 解析或添加失败时抛出错误
     */
    async addFromUri(uri, category = '扫码添加') {
        const handleOffline = async () => {
            const vaultData = parseOtpUri(uri)
            if (!vaultData) throw new Error('Invalid OTP URI')
            vaultData.category = category
            return await this.createAccount(vaultData)
        }

        try {
            const layoutStore = useLayoutStore()
            if (layoutStore.isOffline) return await handleOffline()

            return await request('/api/vault/add-from-uri', {
                method: 'POST',
                body: JSON.stringify({ uri, category })
            })
        } catch (e) {
            if (isNetworkError(e)) {
                console.warn('[VaultService] Network error in addFromUri, falling back')
                return await handleOffline()
            }
            throw new vaultError('Failed to add account from URI', 'ACCOUNT_ADD_URI_FAILED', e)
        }
    },

    /**
     * 导入账号数据 (JSON/RAW 格式)
     * @param {string|Object} vault - 导入的内容
     * @param {'raw'|'bitwarden'|'google'} [type='raw'] - 导入数据源类型
     * @returns {Promise<{success: boolean, count: number}>} 导入成功的详情
     * @throws {vaultError} 导入失败时抛出错误
     */
    async importVault(vault, type = 'raw') {
        const performOffline = async () => {
            const vaultStore = useVaultStore()
            const syncStore = useVaultSyncStore()
            const localData = await vaultStore.getData()
            const currentVault = localData?.vault || []

            const normalize = (s, a) => `${(s || '').trim().toLowerCase()}:${(a || '').trim().toLowerCase()}`
            const existingSigs = new Set(currentVault.map(acc => normalize(acc.service, acc.account)))

            let insertedCount = 0
            const accounts = Array.isArray(vault) ? vault : (typeof vault === 'string' ? JSON.parse(vault) : [vault])
            const actions = []

            for (const acc of accounts) {
                if (!acc) continue

                const sig = normalize(acc.service, acc.account)
                if (existingSigs.has(sig)) {
                    console.debug('[VaultService] Skipping duplicate import in sync queue:', sig)
                    continue
                }

                // ✅ Deep-clone to plain POJO before IDB storage
                let plainAcc
                try {
                    plainAcc = JSON.parse(JSON.stringify(acc))
                } catch {
                    console.warn('[importVault] Account not serializable, skipping:', acc)
                    continue
                }
                const newId = plainAcc.id || (Date.now().toString(36) + Math.random().toString(36).substr(2))
                plainAcc.id = newId
                actions.push({ type: 'create', id: newId, data: plainAcc })
                insertedCount++
                existingSigs.add(sig) // 防止本次导入批次内本身就有重复
            }

            if (actions.length > 0) {
                await syncStore.enqueueActions(actions)
            }

            return { success: true, count: insertedCount, pending: true }
        }

        try {
            const layoutStore = useLayoutStore()
            if (layoutStore.isOffline) return await performOffline()

            return await request('/api/vault/import', {
                method: 'POST',
                body: JSON.stringify({
                    type,
                    content: typeof vault === 'string' ? vault : JSON.stringify(vault)
                })
            })
        } catch (e) {
            if (isNetworkError(e)) {
                return await performOffline()
            }
            throw new vaultError('Failed to import vault data', 'VAULT_IMPORT_FAILED', e)
        }
    },

    /**
     * 同步本地积累的所有离线任务到云端
     * @returns {Promise<{success: boolean}>} 同步执行结果
     * @throws {vaultError} 同步失败时抛出错误
     */
    async syncOfflineActions() {
        const syncStore = useVaultSyncStore()
        if (!syncStore.hasPendingChanges) return
        if (syncStore.isSyncing) return

        try {
            syncStore.isSyncing = true

            // 🔢 分数索引：move-sort 类型走独立的 PATCH 接口，不进批量同步包
            const moveSortActions = syncStore.syncQueue.filter(a => a.type === 'move-sort')
            const batchActions = syncStore.syncQueue.filter(a => a.type !== 'move-sort')

            // 先并发处理所有 move-sort（每个只是 1 次 PATCH 请求）
            const moveSortResults = await Promise.allSettled(
                moveSortActions.map(a =>
                    request(`/api/vault/${a.id}/sort-order`, {
                        method: 'PATCH',
                        body: JSON.stringify({ sortOrder: a.data.sortOrder })
                    })
                )
            )

            // 从队列中移除成功的 move-sort 动作
            const successfulMoveSortIds = new Set(
                moveSortActions
                    .filter((_, i) => moveSortResults[i].status === 'fulfilled')
                    .map(a => a.id)
            )

            if (batchActions.length === 0) {
                // 纯 move-sort 批次，处理完毕后更新队列
                syncStore.syncQueue = syncStore.syncQueue.filter(a => !successfulMoveSortIds.has(a.id))
                await syncStore.saveQueue()
                return { success: true }
            }

            // Prepare actions with version baseline
            const payload = batchActions.map(a => ({
                id: a.id,
                type: a.type,
                data: { ...a.data, updatedAt: a.baselineUpdatedAt }
            }))

            const response = await request('/api/vault/sync', {
                method: 'POST',
                body: JSON.stringify({ actions: payload })
            })

            if (response.success && response.results) {
                // 🛡️ 核心：细粒度处理同步结果
                const results = response.results
                const newQueue = []

                // 处理 batchActions 的结果（与 results 数组对齐）
                for (let i = 0; i < batchActions.length; i++) {
                    const originalAction = batchActions[i]
                    const result = results[i]

                    if (result?.success) {
                        // 同步成功的项不需要进队列
                        continue
                    } else {
                        // 同步失败的项：优先检查 result.error，code 可能被笼统化
                        const code = result?.code || 'error'
                        const error = result?.error || ''
                        const isConflict = code === 'conflict_detected' || error === 'conflict_detected' || code === '409'
                        const isGone = code === '404' || error === 'account_not_found' || code === 'account_not_found'

                        if (isGone) {
                            // 服务器已不存在，本地也就没必要再同步了
                            continue
                        } else if (isConflict) {
                            // 🛡️ 冲突！保留在队列，且标注给 UI 弹窗处理
                            newQueue.push({ ...originalAction, status: 'conflict' })
                        } else {
                            // 其他网络或异常，保留继续同步
                            newQueue.push(originalAction)
                        }
                    }
                }

                // 保留同步失败的 move-sort 动作（未在 successfulMoveSortIds 中的）
                const failedMoveSorts = syncStore.syncQueue.filter(
                    a => a.type === 'move-sort' && !successfulMoveSortIds.has(a.id)
                )
                syncStore.syncQueue = [...newQueue, ...failedMoveSorts]
                await syncStore.saveQueue()
            }
            return response

        } catch (e) {
            console.error('[Sync] Batch sync failed:', e)
            throw new vaultError('Offline sync failed', 'SYNC_FAILED', e)
        } finally {
            syncStore.isSyncing = false
        }
    }
}
