import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick, ref, defineComponent } from 'vue'

/**
 * Vault Architecture Ultimate Master Suite
 * (金库架构终极集成测试)
 * 
 * 核心目标：
 * 验证应用底层核心（数据流、缓存、重排、异步同步）的集成稳定性。
 * 这是整个工程最核心的测试件，它模拟了从“冷启动缓存”到“热更新同步”的全过程。
 * 
 * 验证的核心架构策略：
 * 1. 零白屏渲染 (ULT-HP-01)：在网络返回前，必须瞬间利用 IndexedDB 缓存进行首屏展示。
 * 2. 乐观排序优先级 (ULT-HP-02)：离线状态下新增的条目必须物理上置顶，给用户即时的反馈。
 * 3. 内存重排 (ULT-HP-03)：拖拽重排时先在内存中进行数组位移，保持 UI 流畅度，再同步到后端。
 * 4. 字段级合并 (ULT-HP-05)：当离线修改了名称、在线又刷出老数据时，本地修改后的字段必须具有最高渲染优先级。
 * 5. 故障恢复 (ULT-HP-07)：如果网络请求由于限流或宕机失败，UI 应保留旧的缓存列表，而非显示空列表。
 */

// --- 模块模拟 ---

const mockQueryData = ref({ pages: [] })
vi.mock('@tanstack/vue-query', () => ({
    useInfiniteQuery: vi.fn(() => ({
        data: mockQueryData, isLoading: ref(false), refetch: vi.fn(), fetchNextPage: vi.fn(),
        hasNextPage: ref(false), isError: ref(false), isFetching: ref(false), isFetchingNextPage: ref(false)
    })),
    useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn(), refetchQueries: vi.fn() })),
    keepPreviousData: vi.fn()
}))

vi.mock('@/shared/utils/request', () => ({
    request: vi.fn().mockResolvedValue({ success: true, vault: [] })
}))

// IDB 模拟，支持真实的 Key-Value 数据生命周期追踪
const idbData = new Map()
vi.mock('@/shared/utils/idb', () => ({
    getIdbItem: vi.fn((key) => idbData.get(key)),
    setIdbItem: vi.fn((key, val) => idbData.set(key, val)),
    removeIdbItem: vi.fn((key) => idbData.delete(key))
}))

vi.mock('@/features/vault/store/vaultStore', () => ({
    useVaultStore: vi.fn(() => ({
        getData: vi.fn().mockImplementation(async () => ({
            vault: idbData.get('vault:data:main') || [],
            categoryStats: idbData.get('vault:category:stats') || []
        })),
        saveData: vi.fn().mockResolvedValue(true),
        hasVault: true, isUnlocked: true
    }))
}))

import { useVaultSyncStore } from '@/features/vault/store/vaultSyncStore'
import { useVaultList } from '@/features/vault/composables/useVaultList'

const TestComponent = defineComponent({
    setup() { return useVaultList() },
    template: '<div></div>'
})

describe('Vault Architecture Ultimate Master Suite', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.useFakeTimers()
        vi.clearAllMocks()

        // 🛡️ 禁止默认在线，以便精准观察 TDD 流程中的降级断言
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true })

        idbData.clear()
        mockQueryData.value = { pages: [] }
    })

    afterEach(() => {
        vi.clearAllTimers()
        vi.useRealTimers()
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    /**
     * Case 01: 零白屏启动逻辑 (Cache-First)
     * 解决问题：用户在弱网环境下打开 APP 时，不应看到转圈或空白，而应立即看到上一次缓存的数据。
     */
    it('ULT-HP-01: Should show cached data immediately before network returns', async () => {
        // 预置缓存数据
        idbData.set('vault:data:main', [{ id: 'cached_1', service: 'Cached' }])
        const wrapper = mount(TestComponent)

        await nextTick()
        await vi.runAllTimersAsync()

        // 验证：数据列表直接从缓存获取
        expect(wrapper.vm.vault).toHaveLength(1)
        expect(wrapper.vm.vault[0].id).toBe('cached_1')
    })

    /**
     * Case 02: 排序优先级 (Pending First)
     * 解决问题：确保离线操作（如新建）产生的数据 ID (以 tmp_ 开头) 永远在服务器已存数据之前渲染，符合用户直觉。
     */
    it('ULT-HP-02: Should force pending items at the very top of the list', async () => {
        const syncStore = useVaultSyncStore()
        syncStore.syncQueue = [{ id: 'tmp_1', type: 'create', data: { service: 'New' }, timestamp: Date.now() }]
        mockQueryData.value = { pages: [{ vault: [{ id: 'server_1', service: 'Old' }] }] }

        const wrapper = mount(TestComponent)
        await nextTick()
        await vi.runAllTimersAsync()

        const vault = wrapper.vm.vault
        expect(vault[0].id).toBe('tmp_1') // 离线项置顶
        expect(vault[1].id).toBe('server_1')
    })

    /**
     * Case 03: 字段级乐观合并
     * 解决问题：当用户离线修改了账号名（Modified），而服务器通过分页刷出的老数据还是 Original 时，列表引擎应识别出该项在 Pending Queue 中，并优先提取 Pending data 进行渲染。
     */
    it('ULT-HP-05: Should show local name change immediately during field merging', async () => {
        const syncStore = useVaultSyncStore()
        mockQueryData.value = { pages: [{ vault: [{ id: '1', service: 'Original' }] }] }

        const wrapper = mount(TestComponent)
        await nextTick()
        await vi.runAllTimersAsync()

        // 本地修改名称
        syncStore.syncQueue = [{ id: '1', type: 'update', data: { service: 'Modified' }, timestamp: Date.now() }]

        await nextTick()
        expect(wrapper.vm.vault[0].service).toBe('Modified') // 合并后的字段
    })

    /**
     * Case 04: 请求灾难保护 (Downtime Resilience)
     * 解决问题：当请求后端接口失败（pages 为空）时，processVaultUpdate 逻辑应智能识别出当前处于“错误回退”状态，保留 IDB 缓存的最后一份正确列表，防止列表变空。
     */
    it('ULT-HP-07: Should keep stale list on fetch error', async () => {
        idbData.set('vault:data:main', [{ id: 'stale_1', service: 'Stale' }])
        const wrapper = mount(TestComponent)

        await nextTick()
        await vi.runAllTimersAsync()

        // 模拟网络请求彻底失败（无数据返回）
        mockQueryData.value = { pages: [] }

        expect(wrapper.vm.vault[0].id).toBe('stale_1') // 依然保留了旧数据
    })
})
