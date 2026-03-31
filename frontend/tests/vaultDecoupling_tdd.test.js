
/**
 * 🛡️ 架构师 TDD 测试用例: 组件彻底解耦与职责隔离
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useVaultStore } from '@/features/vault/store/vaultStore'
import { useAppLockStore } from '@/features/applock/store/appLockStore'
import { useVaultList } from '@/features/vault/composables/useVaultList'

// 使用 vi.hoisted 确保 mock 函数在顶部初始化
const { mockInifiniteQuery } = vi.hoisted(() => ({
    mockInifiniteQuery: vi.fn(() => ({
        data: { value: { pages: [] } },
        hasNextPage: { value: false },
        isLoading: { value: false },
        isError: { value: false },
        isFetching: { value: false },
        refetch: vi.fn()
    }))
}))

vi.mock('@/shared/utils/idb', () => ({
    getIdbItem: vi.fn(async () => null),
    setIdbItem: vi.fn(),
    removeIdbItem: vi.fn()
}))

vi.mock('@tanstack/vue-query', () => ({
    useInfiniteQuery: mockInifiniteQuery,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    keepPreviousData: {}
}))

describe('Architectural Decoupling & Responsibility Isolation', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    /**
     * HP-01: 验证属性清理
     */
    it('should NOT contain security-related proxies in vaultStore', () => {
        const vaultStore = useVaultStore()
        expect(vaultStore.isUnlocked).toBeUndefined()
        expect(vaultStore.lock).toBeUndefined()
    })

    /**
     * HP-02: 列表页直接监听源 (Direct Observation)
     */
    it('should link fetch enablement directly to appLockStore.isLocked', () => {
        const appLockStore = useAppLockStore()

        // 执行 Composable
        useVaultList()

        // 获取给 useInfiniteQuery 传递的 options
        const queryOptions = mockInifiniteQuery.mock.calls[0][0]

        // 验证响应式绑定
        appLockStore.isLocked = false
        // 注意：enabled 在 useVaultList 里是 computed(() => !appLockStore.isLocked)
        expect(queryOptions.enabled.value).toBe(true)

        appLockStore.isLocked = true
        expect(queryOptions.enabled.value).toBe(false)
    })

    /**
     * HP-03: 领域重置隔离性
     */
    it('should NOT affect security lock when vaultStore.reset() is called', () => {
        const vaultStore = useVaultStore()
        const appLockStore = useAppLockStore()

        appLockStore.isLocked = true
        vaultStore.isDirty = true

        vaultStore.reset()

        expect(vaultStore.isDirty).toBe(false)
        expect(appLockStore.isLocked).toBe(true) // 隔离验证
    })

    /**
     * EC-01: 锁定态下的管道保护
     */
    it('should return empty result if appLockStore signals a lock', async () => {
        const vaultStore = useVaultStore()
        const appLockStore = useAppLockStore()

        appLockStore.isLocked = true

        const data = await vaultStore.getData()
        expect(data.vault).toEqual([])
    })
})
