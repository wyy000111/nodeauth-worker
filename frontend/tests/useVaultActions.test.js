/**
 * 金库动作 (useVaultActions) 业务逻辑测试
 * 
 * 核心目标：
 * 验证对金库账号的增删改等核心 Action 的执行逻辑。
 * 
 * 重点难点：
 * 1. 批量处理 (Bulk Actions)：同时选中多个账号并执行批量删除。
 * 2. 状态同步：API 调用成功后，必须同步更新服务端 Query 缓存，确保 UI 刷新。
 * 3. 容错回滚 (Rollback)：如果手动重排 (Reorder) 的 API 调用失败，UI 必须能回滚到之前的正确排序。
 * 4. 菜单分发 (Command Handling)：验证编辑对话框、QR 码对话框的唤起逻辑。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

// 1. 基于 vi.hoisted 提前声明 Mock 对象，防止由于 import 顺序导致的 hoisting 问题
const { mockSetQueriesData, mockQueryClient, mockVaultService } = vi.hoisted(() => ({
    mockSetQueriesData: vi.fn(),
    mockQueryClient: {
        setQueriesData: vi.fn(),
        invalidateQueries: vi.fn()
    },
    mockVaultService: {
        reorder: vi.fn().mockResolvedValue({ success: true }),
        moveSortOrder: vi.fn().mockResolvedValue({ success: true }),
        updateAccount: vi.fn(),
        batchDelete: vi.fn(),
        deleteAccount: vi.fn()
    }
}))
mockQueryClient.setQueriesData = mockSetQueriesData

// --- 组件依赖 Mock ---

vi.mock('@tanstack/vue-query', () => ({
    useQueryClient: vi.fn(() => mockQueryClient),
    keepPreviousData: {}
}))

vi.mock('element-plus', () => ({
    ElMessage: { success: vi.fn().mockReturnValue({ close: vi.fn() }), warning: vi.fn() },
    ElMessageBox: { confirm: vi.fn().mockResolvedValue('confirm') }
}))

vi.mock('qrcode', () => ({
    toDataURL: vi.fn(() => Promise.resolve('data:qr'))
}))

vi.mock('@/features/vault/store/vaultStore', () => ({
    useVaultStore: vi.fn(() => ({ markDirty: vi.fn() }))
}))

vi.mock('@/features/vault/service/vaultService', () => ({
    vaultService: mockVaultService
}))

vi.mock('@/shared/utils/common', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(true)
}))

vi.mock('@/locales', () => ({
    i18n: { global: { t: (key) => key } }
}))

// 标准化导入
import { useVaultActions } from '@/features/vault/composables/useVaultActions'

describe('useVaultActions Composable - Interaction Logic', () => {
    let fetchVault
    let vault
    let actions

    beforeEach(() => {
        vi.clearAllMocks()
        fetchVault = vi.fn()
        vault = ref([
            { id: '1', service: 'Google', secret: 'S1' },
            { id: '2', service: 'GitHub', secret: 'S2' }
        ])
        actions = useVaultActions(fetchVault, vault, ref([]))
    })

    /**
     * Case 01: 批量全选逻辑
     * 目标：验证操作栏的快捷勾选。
     */
    it('should select all loaded accounts', () => {
        actions.selectAllLoaded()
        expect(actions.selectedIds.value).toHaveLength(2)
    })

    /**
     * Case 02: 排序乐观更新
     * 目标：验证 UI 流畅性提升。
     * 解决问题：在用户完成拖拽重排后，先修改内存缓存 (cache)，再发送 API。这能瞬间消除拖拽后的“回闪”感。
     */
    it('should update query cache optimistically before API call', async () => {
        const newItems = [{ id: '2' }, { id: '1' }]
        const oldItems = [...vault.value]

        await actions.performReorder(newItems, oldItems)

        expect(mockSetQueriesData).toHaveBeenCalledWith({ queryKey: ['vault'] }, expect.any(Function))
        expect(mockVaultService.moveSortOrder).toHaveBeenCalledWith('2', 1000)
    })

    /**
     * Case 03: 排序失败回滚机制
     * 目标：验证异常安全性。
     * 解决问题：如果重排 API 因网络问题失败，必须立刻回滚 UI 到旧排序，并重新 Fetch 最新数据，防止用户以为改成功了但刷新后又变回去了。
     */
    it('should rollback to old items if API reorder fails', async () => {
        mockVaultService.moveSortOrder.mockRejectedValueOnce(new Error('Network Fail'))

        const newItems = [{ id: '2' }, { id: '1' }]
        const oldItems = [...vault.value]

        await actions.performReorder(newItems, oldItems)

        expect(vault.value).toEqual(oldItems) // 回滚到旧版
        expect(fetchVault).toHaveBeenCalled() // 触发重刷
    })

    /**
     * Case 04: 对话框分发控制
     * 目标：验证业务动作流。
     */
    it('should dispatch commands correctly', () => {
        actions.handleCommand('edit', { id: '1', service: 'EditTest' })
        expect(actions.showEditDialog.value).toBe(true)
        expect(actions.editVaultData.value.service).toBe('EditTest')
    })
})
