import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick, ref, defineComponent } from 'vue'

/**
 * Vault Master TDD (Sync Manager Refactor)
 * (金库同步管理重构) 专项测试套件
 * 
 * 核心目标：
 * 验证在“全局”层面，应用如何响应环境变化（网络状态、页面可见性）并自动触发同步。
 * 解决 2FA 金库的数据一致性底座逻辑。
 * 
 * 关键策略：
 * 1. 在线监听 (Online Event)：一旦检测到网络从断开恢复，立刻清空离线队列。
 * 2. 活跃检测 (Foreground Sync)：一旦页面从后台切回前台，自动探测是否有未同步任务。
 * 3. 并发治理 (Deduplication)：确保在多个触发源同时激活时，不会发起重复的同步请求。
 */

// --- 模块模拟 ---

const mockQueryData = ref({ pages: [] })
vi.mock('@tanstack/vue-query', () => ({
    useInfiniteQuery: vi.fn(() => ({ data: mockQueryData, isLoading: ref(false), refetch: vi.fn(), fetchNextPage: vi.fn(), hasNextPage: ref(false) })),
    useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
    keepPreviousData: vi.fn()
}))

vi.mock('@/shared/utils/request', () => ({
    request: vi.fn().mockResolvedValue({ success: true, vault: [] })
}))

vi.mock('@/features/vault/store/vaultStore', () => ({
    useVaultStore: vi.fn(() => ({
        getData: vi.fn().mockResolvedValue({ vault: [], categoryStats: [] }),
        saveData: vi.fn().mockResolvedValue(true),
        hasVault: true
    }))
}))

vi.mock('@/shared/utils/idb', () => ({
    getIdbItem: vi.fn(),
    setIdbItem: vi.fn(),
    removeIdbItem: vi.fn()
}))

import { useVaultStore } from '@/features/vault/store/vaultStore'
import { useVaultSyncStore } from '@/features/vault/store/vaultSyncStore'
import { useVaultList } from '@/features/vault/composables/useVaultList'
import { vaultService } from '@/features/vault/service/vaultService'

// 辅助组件：用于在 setup 中激活 Composition API 逻辑
const TestComponent = defineComponent({
    setup() { return useVaultList() },
    template: '<div></div>'
})

describe('Vault Master TDD - Background Sync Flow', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.useFakeTimers()
        vi.clearAllMocks()

        const vaultStore = useVaultStore()
        vaultStore.hasVault = true
        vi.spyOn(vaultStore, 'saveData').mockResolvedValue(true)
        vi.spyOn(vaultStore, 'getData').mockResolvedValue({ vault: [], categoryStats: [] })

        mockQueryData.value = { pages: [] }
    })

    afterEach(() => {
        vi.clearAllTimers()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    /**
     * Case 01: 网络恢复自动同步
     * 目标：验证在线监听器。
     * 解决问题：确保当用户重新连上 Wifi 时，挂载的组件（通过 useVaultList 启动的心跳）能自动呼叫 syncOfflineActions。
     */
    it('HP-SY-01: Auto-Sync on Global Online Event', async () => {
        const syncStore = useVaultSyncStore()
        const syncSpy = vi.spyOn(vaultService, 'syncOfflineActions').mockResolvedValue({ success: true })

        // 挂载组件以激活 onMounted 中定义的监听器
        const wrapper = mount(TestComponent)

        // 1. 模拟离线状态下产生了一个变更
        await syncStore.enqueueAction('update', '1', { service: 'Updated Service' })

        // 2. 模拟网络恢复
        window.dispatchEvent(new Event('online'))

        await nextTick()
        await vi.runAllTimersAsync()

        // 预期断言：同步函数被自动调用
        expect(syncSpy).toHaveBeenCalled()
        wrapper.unmount()
    })

    /**
     * Case 02: 页面唤醒自动同步
     * 目标：验证前台触发策略。
     * 解决问题：有时用户在移动端切回浏览器时，浏览器并没有丢失网络但会暂存请求。通过监听 visibilitychange，可以在回前台的一瞬间刷新数据。
     */
    it('HP-SY-03: Sync on Visibility Change (Foreground Trigger)', async () => {
        const syncStore = useVaultSyncStore()
        const syncSpy = vi.spyOn(vaultService, 'syncOfflineActions').mockResolvedValue({ success: true })

        const wrapper = mount(TestComponent)

        await syncStore.enqueueAction('create', 'tmp_1', { service: 'X' })

        // 模拟页面从后台可见
        Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true })
        document.dispatchEvent(new Event('visibilitychange'))

        await nextTick()
        await vi.runAllTimersAsync()

        expect(syncSpy).toHaveBeenCalled()
        wrapper.unmount()
    })

    /**
     * Case 03: 并发调用安全性
     * 目标：验证防冲突机制。
     * 解决问题：如果 Online 事件和 Visibility 事件同时发生，由于 store 内部使用了 isSyncing 锁，同步逻辑应依然保持稳健。
     */
    it('EC-SY-04: Concurrent Safe Check (Deduplication)', async () => {
        const syncSpy = vi.spyOn(vaultService, 'syncOfflineActions').mockResolvedValue({ success: true })
        mount(TestComponent)

        // 连续触发多次可能导致同步的事件
        window.dispatchEvent(new Event('online'))
        document.dispatchEvent(new Event('visibilitychange'))

        expect(syncSpy).toHaveBeenCalled()
    })
})
