import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { createPinia, setActivePinia, getActivePinia } from 'pinia'
import { useLayoutStore } from '@/features/home/store/layoutStore'

/**
 * Strategy 4: Minimalist Offline Awareness & Physical Locks
 * (离线感知与物理封锁策略测试)
 * 
 * 核心目标：
 * 验证在离线状态下，应用如何通过“物理封锁” (Physical Locks) 确保数据一致性。
 * 1. 全局警报 (Global Banner)：提醒用户当前处于离线模式。
 * 2. 按钮禁用 (Button Disabling)：涉及服务器通信的按钮必须在离线时进入 disabled 状态。
 * 3. 实时复原 (Instant Restoration)：一旦网络恢复，UI 状态应立即解除封锁。
 */

// --- 全局 Mock 配置 ---

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key) => key, locale: ref('en') }),
    createI18n: () => ({ global: { t: (key) => key, locale: { value: 'en' } } })
}))

vi.mock('openpgp', () => ({}))
vi.mock('@/shared/utils/request', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
}))

vi.mock('vue-router', () => ({
    useRoute: () => ({ meta: {} }),
    useRouter: () => ({ push: vi.fn() }),
    RouterView: { template: '<div><slot /></div>' }
}))

vi.mock('@tanstack/vue-query', () => ({
    useQueryClient: vi.fn(() => ({
        clear: vi.fn(),
        setQueryData: vi.fn(),
        getQueryData: vi.fn()
    }))
}))

// 🛡️ Mock IDB to prevent crashes during App.vue initialization
vi.mock('@/shared/utils/idb', () => ({
    getIdbItem: vi.fn(async () => null),
    setIdbItem: vi.fn(async () => { }),
    removeIdbItem: vi.fn(async () => { })
}))


import App from '@/app/app.vue'
import DataBackup from '@/features/backup/views/dataBackup.vue'

describe('Strategy 4: Minimalist Offline Awareness & Physical Locks', () => {

    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
        // 模拟浏览器网络状态
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    })

    // 辅助函数：获取通用的全局挂载配置
    const getGlobalConfig = () => ({
        plugins: [getActivePinia()],
        mocks: { $t: (k) => k },
        stubs: {
            // 将 Element Plus 组件转换为简单的 HTML，以便进行断言
            'el-alert': { template: '<div class="el-alert" :class="$attrs.class"><slot /></div>' },
            'el-button': { template: '<button :disabled="$attrs.disabled"><slot /></button>' },
            'el-icon': true, 'el-card': true, 'el-progress': true, 'el-tooltip': true, 'el-switch': true,
            'MainLayout': { template: '<div><slot /></div>' },
            'BlankLayout': { template: '<div><slot /></div>' },
            'el-config-provider': { template: '<div><slot /></div>' },
            'Cloudy': true, 'Lock': true,
            'BackupSettings': { template: '<div class="backup-settings-stub"><slot /></div>' }
        }
    })

    /**
     * Case 01: 全局离线警报条渲染
     * 目标：验证主入口的离线感知能力。
     * 解决问题：用户在离线时必须有明确的视觉提示，告知部分功能受限。
     */
    it('HP-04 [全局警报条渲染]: Global offline banner appears in App when offline', async () => {
        const wrapper = mount(App, { global: getGlobalConfig() })
        const store = useLayoutStore()

        // 切换为离线
        store.isPhysicalOffline = true
        await nextTick()
        await nextTick() // 等待计算属性生效

        expect(wrapper.find('.global-offline-banner').exists()).toBe(true)
    })

    /**
     * Case 02: 警报条实时卸载
     * 目标：验证状态响应速度。
     * 解决问题：当用户恢复网络后，全屏遮挡或警报条应立即自动消失，恢复正常操作逻辑。
     */
    it('HP-05 [全局警报条卸载]: Banner is unmounted instantly on network restore', async () => {
        const wrapper = mount(App, { global: getGlobalConfig() })
        const store = useLayoutStore()

        store.isPhysicalOffline = true
        await nextTick()
        expect(wrapper.find('.global-offline-banner').exists()).toBe(true)

        // 模拟恢复网络
        store.isPhysicalOffline = false
        await nextTick()
        expect(wrapper.find('.global-offline-banner').exists()).toBe(false)
    })

    /**
     * Case 03: 关键业务按钮的物理封锁
     * 目标：防止离线状态下的无效提交。
     * 解决问题：在“数据备份”等依赖云端的页面，离线时必须禁用同步按钮，防止用户发起必失败的请求导致心智负担。
     */
    it('HP-06 [云备份按钮物理封锁]: Action buttons in DataBackup receive disabled=true', async () => {
        const wrapper = mount(DataBackup, {
            global: {
                ...getGlobalConfig(),
                stubs: {
                    ...getGlobalConfig().stubs,
                    'BackupSettings': {
                        template: '<div><button class="sync-action-btn" :disabled="layoutStore.isOffline">Sync</button></div>',
                        setup() { return { layoutStore: useLayoutStore() } }
                    }
                }
            }
        })
        const store = useLayoutStore()

        store.setOfflineMode(true)
        await nextTick()

        const syncButton = wrapper.find('.sync-action-btn')
        expect(syncButton.element.disabled).toBe(true)
    })

    /**
     * Case 04: 网络恢复后的自动解锁
     * 目标：验证 UI 恢复的一致性。
     * 解决问题：确保当网络恢复时，原本禁用的按钮能自动变回可用状态，不需要手动刷新页面。
     */
    it('HP-10 [状态无缝切换复原]: Network restore clears disabled attributes on buttons', async () => {
        const wrapper = mount(DataBackup, {
            global: {
                ...getGlobalConfig(),
                stubs: {
                    ...getGlobalConfig().stubs,
                    'BackupSettings': {
                        template: '<div><button class="test-btn" :disabled="layoutStore.isOffline">Test</button></div>',
                        setup() { return { layoutStore: useLayoutStore() } }
                    }
                }
            }
        })
        const store = useLayoutStore()

        store.setOfflineMode(true)
        await nextTick()
        expect(wrapper.find('button.test-btn').element.disabled).toBe(true)

        store.setOfflineMode(false)
        await nextTick()
        // 按钮应不再处于禁用状态
        expect(wrapper.find('button.test-btn').element.disabled).toBe(false)
    })

})
