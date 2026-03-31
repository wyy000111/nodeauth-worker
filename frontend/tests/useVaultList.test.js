import { vi, describe, it, expect, beforeEach } from 'vitest'
import { ref, reactive, nextTick, defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

/**
 * useVaultList Composable - 业务逻辑核心测试套件
 * 
 * 核心目标：
 * 验证“数据合流引擎” (Merge Engine) 的正确性。这是应用最复杂的逻辑之一：
 * 它需要将来自 Tanstack Query 的服务端分页数据与来自 VaultSyncStore 的本地离线修改实时合并。
 * 
 * 覆盖重点：
 * 1. 乐观更新覆盖逻辑：当本地有 update 行为时，UI 应显示本地修改后的数据。
 * 2. 统计数值准确性：总数 (absoluteTotalItems) 应包含服务端总数 + 离线待创建数。
 */

// 1. 模拟依赖项 (Mocks)
vi.mock('@tanstack/vue-query', () => ({
    useInfiniteQuery: vi.fn(),
    useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
    keepPreviousData: {}
}))

vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: vi.fn(() => ({ appVaultViewMode: 'card', isMobile: false }))
}))

vi.mock('@/features/vault/store/vaultStore', () => ({
    useVaultStore: vi.fn(() => ({
        isUnlocked: true, hasVault: true, getData: vi.fn().mockResolvedValue({ vault: [], stats: [] }), saveData: vi.fn()
    }))
}))

// 创建响应式的同步状态 Mock 
const syncState = reactive({
    syncQueue: [], isSyncing: false, initQueue: vi.fn().mockResolvedValue(),
    hasPendingChanges: false, isItemPending: vi.fn(() => false)
})

vi.mock('@/features/vault/store/vaultSyncStore', () => ({
    useVaultSyncStore: vi.fn(() => syncState)
}))

vi.mock('@/features/vault/service/vaultService', () => ({
    vaultService: { getVault: vi.fn(), syncOfflineActions: vi.fn() }
}))

import { useVaultList } from '@/features/vault/composables/useVaultList'

describe('useVaultList Composable - Logic Suite', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
        syncState.syncQueue = []
    })

    // 辅助工具：创建一个专门用于测试 Composable 的宿主组件
    const TestHost = (setupFn) => defineComponent({
        setup() { const result = setupFn(); return { result } },
        template: '<div></div>'
    })

    /**
     * Case 01: 服务端数据与乐观更新的实时合并
     * 目标：验证数据优先级。
     * 解决问题：当用户离线修改了某个账号名称后，回到列表页时，即使服务端还没同步，用户也应看到自己新改的名字。
     */
    it('should correctly merge server data and optimistic updates', async () => {
        const { useInfiniteQuery } = await import('@tanstack/vue-query')
        // 模拟初始服务端返回数据：'Original'
        const mockData = ref({ pages: [{ vault: [{ id: '1', service: 'Original' }] }] })

        useInfiniteQuery.mockReturnValue({
            data: mockData, isLoading: ref(false), isFetching: ref(false),
            isError: ref(false), hasNextPage: ref(false)
        })

        const wrapper = mount(TestHost(() => useVaultList()))
        await nextTick()

        // 模拟同步队列中的离线更新行为：'Updated'
        syncState.syncQueue = [{ id: '1', type: 'update', data: { service: 'Updated' } }]

        await nextTick()
        // 断言：合流后的数据应以离线修改为正，显示 'Updated'
        expect(wrapper.vm.result.vault.value[0].service).toBe('Updated')
        wrapper.unmount()
    })

    /**
     * Case 02: 列表总数统计逻辑
     * 目标：验证 UI 计数器准确性。
     * 解决问题：列表底部的计数器不仅要算上已存在的数据，还要动态算入“离线待新增”的数量，给用户正确的心理预期。
     */
    it('should correctly sum total items', async () => {
        const { useInfiniteQuery } = await import('@tanstack/vue-query')
        // 模拟服务端有 5 个已知项
        const mockData = ref({ pages: [{ vault: [], categoryStats: [{ category: '', count: 5 }] }] })

        useInfiniteQuery.mockReturnValue({
            data: mockData, isLoading: ref(false), isFetching: ref(false),
            isError: ref(false), hasNextPage: ref(false)
        })

        const wrapper = mount(TestHost(() => useVaultList()))
        await nextTick()

        // 断言：计算公式：5 (Server 已存) + 1 (Pending Creation 离线待建) = 6
        syncState.syncQueue = [{ id: 'tmp_1', type: 'create', data: { service: 'New' } }]

        await nextTick()
        await vi.waitFor(() => {
            // 使用 absoluteTotalItems 进行验证
            if (wrapper.vm.result.absoluteTotalItems.value !== 6) throw new Error('Wait')
            return true
        })

        expect(wrapper.vm.result.absoluteTotalItems.value).toBe(6)
        wrapper.unmount()
    })
})
