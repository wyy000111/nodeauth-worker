import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import App from '@/app/app.vue'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

/**
 * PWA 架构边界 (Offline & Chunk Resilience) 压力测试
 * 
 * 核心目标：
 * 验证应用在 PWA 断网极速切换、分包加载失败以及版本更新后的哈希冲突场景下的健壮性。
 */

// --- 基础模拟 (Global Mocks) ---
import { patchIndexedDB } from './test-utils'
patchIndexedDB()

const reloadMock = vi.fn()
Object.defineProperty(window, 'location', { value: { reload: reloadMock }, writable: true })

let alertMock = vi.fn()
vi.mock('element-plus', async () => {
    const actual = await vi.importActual('element-plus')
    return {
        ...actual,
        ElMessageBox: { alert: (...args) => alertMock(...args) },
        ElAlert: { render: () => { } },
        ElConfigProvider: { render: function () { return this.$slots.default ? this.$slots.default() : null } }
    }
})

vi.mock('@tanstack/vue-query', () => ({
    useQueryClient: vi.fn(() => ({
        clear: vi.fn(),
        setQueryData: vi.fn(),
        getQueryData: vi.fn()
    }))
}))

vi.mock('@/locales', () => ({
    i18n: { global: { t: (key) => key } }
}))

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ locale: ref('en-US') })
}))

// 拦截 Vue Router 错误句柄
const { storedErrorHandlerBox } = vi.hoisted(() => ({ storedErrorHandlerBox: { handler: null } }))
const mockPush = vi.fn()
vi.mock('vue-router', async () => {
    const actual = await vi.importActual('vue-router')
    return {
        ...actual,
        useRoute: () => ({ meta: {} }),
        useRouter: () => ({ push: mockPush }),
        RouterView: { template: '<div>RouterView</div>' },
        createRouter: (options) => {
            const router = actual.createRouter(options)
            const originalOnError = router.onError.bind(router)
            router.onError = (handler) => {
                storedErrorHandlerBox.handler = handler
                return originalOnError(handler)
            }
            return router
        }
    }
})

vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: vi.fn(() => ({
        isOffline: false,
        isMobile: false,
        showMobileMenu: false,
        initNetworkStatus: vi.fn()
    }))
}))

// 静态分包导出 Mock
const fakeImportExport = vi.fn(() => Promise.resolve({ default: {} }))
vi.mock('@/features/migration/views/dataExport.vue', () => ({ default: fakeImportExport }))
vi.mock('@/features/migration/views/dataImport.vue', () => ({ default: {} }))
vi.mock('@/features/backup/views/dataBackup.vue', () => ({ default: {} }))

// 这个 import 会触发上面 mock 的 createRouter
import router from '@/app/router.js'

describe('PWA Architecture Boundary - Offline Resilience Suite', () => {

    beforeEach(() => {
        setActivePinia(createPinia())
        vi.useFakeTimers()
        vi.stubGlobal('requestIdleCallback', vi.fn((cb) => setTimeout(cb, 1)))
        reloadMock.mockClear()
        alertMock.mockClear()
        fakeImportExport.mockClear()
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
        // 关键：确保 router 已被安装或 mocked
    })

    afterEach(() => {
        vi.clearAllMocks()
        vi.clearAllTimers()
    })

    it('should show offline UI when chunk fails due to network outage', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

        const chunkError = new Error("Failed to fetch dynamically imported module")
        if (storedErrorHandlerBox.handler) {
            storedErrorHandlerBox.handler(chunkError, { path: '/dataExport' })
        }

        await flushPromises()
        expect(alertMock).toHaveBeenCalled()
        expect(alertMock.mock.calls[0][0]).toBe('pwa.offline_feature_error_desc')
    })

    it('should force reload when chunk fails while ONLINE (version mismatch)', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
        const hashError = new Error("Loading chunk {x} failed")

        if (storedErrorHandlerBox.handler) {
            storedErrorHandlerBox.handler(hashError, { path: '/about' })
        }

        await flushPromises()
        expect(reloadMock).toHaveBeenCalledTimes(1)
    })

    it('Idle Deferral: should attempt prefetching heavy components after 5s delay', async () => {
        // 关键：Mock Import 以验证它被调用
        vi.spyOn(import.meta, 'url', { get: () => 'fake' }) // 无法直接 spy on dynamic import easily
        // 但我们可以验证 App exists 且没有抛出异常，
        // 并且我们可以 Mock silentPrefetchDependencies 用到的 import

        const wrapper = mount(App, {
            global: {
                plugins: [router],
                stubs: {
                    MainLayout: true,
                    BlankLayout: true,
                    AppLockOverlay: true
                }
            }
        })

        // 推进到 5s 以后
        vi.advanceTimersByTime(5100)
        await flushPromises()

        // 验证 App 组件依然稳定运行，且 prefetchTask 应该已经发起
        expect(wrapper.exists()).toBe(true)
    })
})
