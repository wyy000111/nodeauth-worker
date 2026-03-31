import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/vue'
import { ref, reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import VaultList from '@/features/vault/views/vaultList.vue'
import { commonStubs } from './test-utils'

/**
 * VaultList Component (金库列表视图) 交互集成测试
 * 
 * 核心目标：
 * 验证金库主页面的组件编排与用户交互流。
 * 重点：搜索框、批量操作栏 (Bulk Actions) 的显隐切换与状态绑定。
 */

// --- 模块模拟 ---

vi.mock('@/locales', () => ({
    i18n: { global: { t: (k) => k, te: () => true, install: vi.fn() } }
}))

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (k) => k }),
    createI18n: vi.fn(() => ({ global: { t: (k) => k } }))
}))

vi.mock('@/features/vault/composables/useVaultList', () => ({
    useVaultList: vi.fn()
}))

vi.mock('@/features/vault/composables/useVaultActions', () => ({
    useVaultActions: vi.fn()
}))

vi.mock('@/features/vault/composables/useTotpTimer', () => ({
    useTotpTimer: vi.fn(() => ({
        updateVaultStatus: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), currentTime: ref(0)
    }))
}))

vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: () => ({ isMobile: false, appVaultViewMode: 'card', setVaultViewMode: vi.fn(), app_active_tab: 'vault', isOffline: false })
}))

vi.mock('@/features/vault/store/vaultStore', () => ({
    useVaultStore: () => ({ getData: vi.fn(), hasVault: true, isUnlocked: true })
}))

// 创建响应式的同步存储模拟
const syncState = reactive({
    syncQueue: [],
    isInitialized: true,
    initQueue: vi.fn(),
    isItemPending: vi.fn((id) => syncState.syncQueue.some(a => a.id === id))
})

vi.mock('@/features/vault/store/vaultSyncStore', () => ({
    useVaultSyncStore: () => syncState
}))

describe('VaultList Component - Interaction Suite', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
        syncState.syncQueue = []
    })

    /**
     * 助手函数：设置 Composable 的 Mock 返回值
     */
    const setupMocks = async (options = {}) => {
        const { useVaultList } = await import('@/features/vault/composables/useVaultList')
        const { useVaultActions } = await import('@/features/vault/composables/useVaultActions')

        useVaultList.mockReturnValue({
            vault: ref(options.vault || []),
            searchQuery: ref(''),
            isLoading: ref(options.isLoading || false),
            isFetchingNextPage: ref(false),
            hasNextPage: ref(false),
            absoluteTotalItems: ref(options.vault ? options.vault.length : 0),
            categoryStats: ref([]),
            localCategoryStats: ref([]),
            isLoadMoreDisabled: ref(true),
            handleLoadMore: vi.fn(),
            refetch: vi.fn()
        })

        useVaultActions.mockReturnValue({
            selectedIds: ref(options.selectedIds || []),
            isBulkDeleting: ref(options.isBulkDeleting || false),
            categoryOptions: ref([]),
            handleCommand: vi.fn()
        })
    }

    /**
     * Case 01: 批量操作状态机
     * 目标：验证批量删除时的按钮反馈。
     * 解决问题：当用户选中多个设备并点击批量删除时，删除按钮必须进入 loading 状态，防止重复点击。
     */
    it('should show bulk deleting loading state', async () => {
        // 1. 设置处于正在批量删除的数据状态
        await setupMocks({ selectedIds: ['1'], isBulkDeleting: true, vault: [{ id: '1', service: 'A' }] })

        render(VaultList, {
            global: {
                mocks: { $t: (k) => k },
                directives: { 'infinite-scroll': vi.fn() },
                stubs: { ...commonStubs, 'el-affix': { template: '<div><slot /></div>' }, 'el-segmented': true, 'VaultIcon': true }
            }
        })

        // 2. 找到对应的删除按钮并断言 loading 属性
        const deleteBtn = screen.getByText('common.delete').closest('button')
        expect(deleteBtn.getAttribute('loading')).toBe('true')
    })
})
