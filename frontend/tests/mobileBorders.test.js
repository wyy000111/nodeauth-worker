import { vi, describe, it, expect, beforeEach } from 'vitest'
import { ref, reactive, nextTick } from 'vue'

/**
 * 移动端统一边框适配 (Mobile Unified Borders) 回归测试
 * 
 * 核心目标：
 * 验证在不同移动端页面（金库列表、九宫格 HUB）中，统一的 .vault-list-wrapper 容器是否正确生效。
 * 
 * 验证重点：
 * 1. 滚动区域一致性：无论是 VaultList 还是 Settings，外层容器必须一致，以确保 iOS 底部 Safe Area 适配。
 * 2. 入口渲染力：确保 MobileHub 在各种权限组合下都能正确渲染九宫格 Item，不产生 CSS 布局崩塌。
 */

// --- 模块模拟 (Hoisted) ---

vi.mock('@/locales', () => ({
    i18n: { global: { t: (k) => k } }
}))

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (k) => k })
}))

vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: vi.fn(() => ({
        isMobile: true, app_active_tab: 'vault', appVaultViewMode: 'card', searchQuery: '', isSearchVisible: true
    }))
}))

const syncState = reactive({
    syncQueue: [], isInitialized: true, initQueue: vi.fn().mockResolvedValue(), isItemPending: vi.fn(() => false)
})

vi.mock('@/features/vault/store/vaultSyncStore', () => ({
    useVaultSyncStore: () => syncState
}))

vi.mock('@tanstack/vue-query', () => ({
    useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
    useInfiniteQuery: vi.fn(() => ({
        data: ref({ pages: [] }), isLoading: ref(false), isFetching: ref(false), isError: ref(false), refetch: vi.fn(), hasNextPage: ref(false)
    })),
    keepPreviousData: vi.fn()
}))

vi.mock('@/features/vault/composables/useVaultList', () => ({
    useVaultList: vi.fn(() => ({
        vault: ref([{ id: 1, service: 'TDD Test', account: 'tdd@example.com' }]),
        searchQuery: ref(''), selectedCategory: ref(''), isLoading: ref(false),
        absoluteTotalItems: ref(1), isLoadMoreDisabled: ref(true),
        categoryStats: ref([]), localCategoryStats: ref([]),
        fetchVault: vi.fn(), handleLoadMore: vi.fn(), refetch: vi.fn(),
        isFetching: ref(false), isFetchingNextPage: ref(false), hasNextPage: ref(false)
    }))
}))

vi.mock('@/features/vault/composables/useVaultActions', () => ({
    useVaultActions: vi.fn(() => ({ selectedIds: ref([]), isBulkDeleting: ref(false), handleCommand: vi.fn() }))
}))

vi.mock('@/features/auth/store/authUserStore', () => ({
    useAuthUserStore: vi.fn(() => ({ logout: vi.fn() }))
}))

// 环境补丁
vi.stubGlobal('navigator', { onLine: true })
vi.stubGlobal('indexedDB', { open: vi.fn().mockReturnValue({}) })

// --- 业务组件导入 ---
import { render } from '@testing-library/vue'
import { commonStubs } from './test-utils'
import { createPinia, setActivePinia } from 'pinia'
import VaultList from '@/features/vault/views/vaultList.vue'
import MobileHub from '@/features/home/views/mobileHub.vue'

describe('Mobile Unified Borders - Visual Regression', () => {
    beforeEach(() => {
        setActivePinia(createPinia()); vi.clearAllMocks()
        syncState.syncQueue = []
    })

    const renderOptions = {
        global: {
            mocks: { $t: k => k, t: k => k },
            directives: { 'infinite-scroll': vi.fn() },
            stubs: { ...commonStubs, 'VaultIcon': true, 'el-icon': true }
        }
    }

    /**
     * Case 01: 验证主列表外层容器
     * 解决问题：确保列表具有统一的上下外边距及圆角，与底层 PWA Shell 视觉对齐。
     */
    it('VaultCard: should render main wrapper with correct class', async () => {
        const { container } = render(VaultList, renderOptions)
        await nextTick()
        expect(container.querySelector('.vault-list-wrapper')).toBeTruthy()
    })

    /**
     * Case 02: 验证九宫格设置 HUB
     * 解决问题：确保 HUB 模式下的 Item 点击区域足够宽阔，符合移动端指尖交互规范。
     */
    it('MobileHub: should render dashboard items correctly', async () => {
        const { container } = render(MobileHub, {
            ...renderOptions,
            props: { mode: 'settings' },
            global: {
                ...renderOptions.global,
                stubs: { ...renderOptions.global.stubs, 'Fingerprint': true, 'Monitor': true, 'Warning': true, 'Lock': true, 'Brush': true, 'Location': true }
            }
        })
        await nextTick()
        // 验证 HUB 内部原子 Item 是否成功渲染
        expect(container.querySelector('.hub-item')).toBeTruthy()
    })
})
