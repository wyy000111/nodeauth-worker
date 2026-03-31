import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { vaultService } from '@/features/vault/service/vaultService'
import { useVaultSyncStore } from '@/features/vault/store/vaultSyncStore'
import { request } from '@/shared/utils/request'

/**
 * Vault Sync Conflict (冲突解决) - Red Phase Tests
 * 
 * 按照架构师规格说明书，验证由于 updatedAt 不一致导致的同步冲突处理逻辑。
 */

vi.mock('@/shared/utils/request', () => ({
    request: vi.fn()
}))

vi.mock('@/shared/utils/idb', () => ({
    getIdbItem: vi.fn(),
    setIdbItem: vi.fn(),
    removeIdbItem: vi.fn()
}))

const mockOnline = (status) => {
    Object.defineProperty(navigator, 'onLine', {
        value: status,
        configurable: true
    })
}

describe('Vault Sync Conflict Resolution [Red Phase]', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.restoreAllMocks()
        mockOnline(true)
    })

    /**
     * HP_1: 顺滑同步 (Clean Sync)
     * 预期：携带正确的 updatedAt 同步成功。
     */
    it('HP_1: should sync successfully when updatedAt matches baseline', async () => {
        const syncStore = useVaultSyncStore()
        const lastUpdated = 1000
        const nextUpdated = 1100

        // 模拟离线入队
        await syncStore.enqueueAction('update', 'acc_1', {
            service: 'Matches',
            updatedAt: lastUpdated // 离线时保存的旧快照
        })

        // 模拟后端成功返回
        vi.mocked(request).mockResolvedValueOnce({
            success: true,
            results: [{
                success: true,
                id: 'acc_1',
                updatedAt: nextUpdated // 后端生成的新时间戳
            }]
        })

        await vaultService.syncOfflineActions()

        expect(request).toHaveBeenCalled()
        expect(syncStore.hasPendingChanges).toBe(false)
        // 注意：此处需要验证本地项的 updatedAt 是否被更新（目前代码尚未实现，应失败）
    })

    /**
     * EC_1: 版本冲突拦截 (Stale Update Conflict)
     * 预期：由于服务器版本已更新，同步应返回冲突。
     */
    it('EC_1: should fail with Conflict (409) when server has newer updatedAt', async () => {
        const syncStore = useVaultSyncStore()

        await syncStore.enqueueAction('update', 'acc_stale', {
            service: 'I am old',
            updatedAt: 1000
        })

        // 使用真实后端的返回格式：HTTP 200，但 results 里包含失败项
        // 真实后端: { error: 'conflict_detected', code: 'sync_error' }
        // （不是直接抛 rejected promise，也不是 code: 'conflict_detected'）
        vi.mocked(request).mockResolvedValueOnce({
            success: true,
            results: [{
                success: false,
                type: 'update',
                id: 'acc_stale',
                error: 'conflict_detected',  // 真实字段
                code: 'sync_error'            // 后端 catch 中会产生 sync_error，修复后为 conflict_detected
            }]
        })

        await vaultService.syncOfflineActions()

        // 核心断言：冲突项必须保留在队列，且 status 标记为 'conflict'
        expect(syncStore.hasPendingChanges).toBe(true)
        expect(syncStore.syncQueue[0].id).toBe('acc_stale')
        expect(syncStore.syncQueue[0].status).toBe('conflict') // 🔴 这是关键：UI 弹窗依赖此字段
    })

    /**
     * EC_2: 更新已删除项 (Update to Deleted)
     * 预期：服务器返回 404，前端标记错误并建议清理。
     */
    it('EC_2: should handle sync failure when item is already deleted on server', async () => {
        const syncStore = useVaultSyncStore()
        await syncStore.enqueueAction('update', 'acc_gone', { service: 'Update Me' })

        vi.mocked(request).mockResolvedValueOnce({
            success: true,
            results: [{
                success: false,
                id: 'acc_gone',
                error: 'account_not_found',
                code: '404'
            }]
        })

        await vaultService.syncOfflineActions()

        // 逻辑：如果后端明确说删除了，前端队列应清理该项，或者标记为冲突
        expect(syncStore.hasPendingChanges).toBe(false)
    })

    /**
     * EC_3: 删除已更新项 (Delete Stale)
     * 预期：当尝试删除一个已经又被更新过的项时，后端防撞拦截。
     */
    it('EC_3: should prevent deleting an item that was updated by another device', async () => {
        const syncStore = useVaultSyncStore()
        await syncStore.enqueueAction('delete', 'acc_critical', { updatedAt: 1000 })

        vi.mocked(request).mockResolvedValueOnce({
            success: true,
            results: [{
                success: false,
                id: 'acc_critical',
                error: 'conflict_detected',
                code: '409'
            }]
        })

        await vaultService.syncOfflineActions()

        // 失败的删除请求不应从队列移除，直到用户决定如何处理
        expect(syncStore.hasPendingChanges).toBe(true)
    })

    /**
     * HP_4: 离线新建不应参与版本冲突校验
     */
    it('HP_4: should NOT check version for new items (create action)', async () => {
        const syncStore = useVaultSyncStore()
        await syncStore.enqueueAction('create', 'tmp_new', { service: 'New Site' })

        vi.mocked(request).mockResolvedValueOnce({
            success: true,
            results: [{ success: true, id: 'tmp_new', serverId: 'real_1' }]
        })

        await vaultService.syncOfflineActions()
        expect(syncStore.hasPendingChanges).toBe(false)
    })

    /**
     * TDD: Conflict Resolution - Resolve with Force
     */
    it('TDD_1: should allow resolving conflict with FORCE strategy', async () => {
        const syncStore = useVaultSyncStore()

        // 1. Setup a conflict state manually (mimicking a previous failed sync)
        syncStore.syncQueue = [{
            id: 'acc_conflict',
            type: 'update',
            status: 'conflict', // 🛡️
            data: { service: 'My Local Overwrite', updatedAt: 1000 }
        }]

        // 2. User chooses "Force"
        await syncStore.resolveConflict('acc_conflict', 'force')

        // 3. Verify state: status reset and force flag added
        expect(syncStore.syncQueue[0].status).toBe('pending')
        expect(syncStore.syncQueue[0].data.force).toBe(true)

        // 4. Mock successful sync (sending force=true to backend)
        vi.mocked(request).mockResolvedValueOnce({
            success: true,
            results: [{ success: true, id: 'acc_conflict' }]
        })

        await vaultService.syncOfflineActions()

        expect(syncStore.syncQueue.length).toBe(0)
    })

    /**
     * TDD: Conflict Resolution - Discard Local
     */
    it('TDD_2: should allow resolving conflict by DISCARDING local changes', async () => {
        const syncStore = useVaultSyncStore()

        syncStore.syncQueue = [{
            id: 'acc_conflict',
            type: 'update',
            status: 'conflict',
            data: { service: 'Discard Me', updatedAt: 1000 }
        }]

        // User chooses "Discard"
        await syncStore.resolveConflict('acc_conflict', 'discard')

        // Verify: Item removed immediately
        expect(syncStore.syncQueue.length).toBe(0)
    })
})
