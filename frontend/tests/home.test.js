/**
 * 首页布局 (Home Layout) 响应式集成测试
 * 
 * 核心目标：
 * 验证 PWA 应用在不同设备尺寸（桌面端/移动端）下的容器切割逻辑。
 * 
 * 测试策略：
 * 1. 结构化挂载：验证 Desktop 模式下渲染 Sidebar + Body，Mobile 模式下渲染 Body + Bottom Menu。
 * 2. 状态自润 (Self-Calibration)：解决 PWA 冷启动时 app_active_tab 可能因为 URL Hash 缺失而处于非法状态的问题。
 * 3. 实时切换灵敏度：验证 LayoutStore 改变 isMobile 属性后，DOM 容器能否瞬间响应式切换，不产生 UI 粘连。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/vue'
import { nextTick } from 'vue'
import Home from '@/features/home/views/home.vue'
import { commonStubs } from './test-utils'

// --- Layout Store 模拟 (具备响应式) ---

vi.mock('@/features/home/store/layoutStore', async () => {
    const { reactive } = await import('vue')
    const state = reactive({
        app_active_tab: 'vault',
        isMobile: false,
        setActiveTab: (val) => { state.app_active_tab = val }
    })
    return {
        useLayoutStore: () => state,
        __state: state // 暴露内部状态供测试脚本操作
    }
})

describe('Home Layout Integration - Device Adaptation', () => {
    let layoutStoreState

    const localStubs = {
        ...commonStubs,
        'desktopMenu': { template: '<div class="desktop-sidebar-stub">Sidebar</div>' },
        'desktopBody': { template: '<div class="desktop-body-stub">DesktopBody</div>' },
        'mobileBody': { template: '<div class="mobile-body-stub">MobileBody</div>' },
        'MobileMenu': { template: '<div class="mobile-menu-stub">MobileMenu</div>' },
    }

    beforeEach(async () => {
        vi.clearAllMocks()
        const mockModule = await vi.importMock('@/features/home/store/layoutStore')
        layoutStoreState = mockModule.__state
        layoutStoreState.app_active_tab = 'vault'
        layoutStoreState.isMobile = false
    })

    /**
     * Case 01: 桌面端标准三栏布局渲染
     */
    it('should render desktop layout (sidebar + body) when isMobile is false', async () => {
        layoutStoreState.isMobile = false
        render(Home, { global: { mocks: { $t: k => k }, stubs: localStubs } })

        expect(screen.getByText('Sidebar')).toBeTruthy()
        expect(screen.getByText('DesktopBody')).toBeTruthy()
        expect(screen.queryByText('MobileBody')).toBeNull() // 确认移动端版被切除
    })

    /**
     * Case 02: 移动端底部菜单布局渲染
     */
    it('should render mobile layout (body + menu) when isMobile is true', async () => {
        layoutStoreState.isMobile = true
        render(Home, { global: { mocks: { $t: k => k }, stubs: localStubs } })

        await nextTick()
        expect(screen.getByText('MobileBody')).toBeTruthy()
        expect(screen.getByText('MobileMenu')).toBeTruthy()
        expect(screen.queryByText('Sidebar')).toBeNull() // 侧边栏应消失
    })

    /**
     * Case 03: 初始化 Tab 校准 (Tab Calibration)
     * 目标：增强 Robustness。
     * 解决问题：如果用户直接修改 LocalStorage 或由于 Hash 错误进入了一个不存在的 Tab，Home 挂载时应自动校准回 'vault'，防止页面卡死或渲染空白。
     */
    it('should calibrate app_active_tab on mount (Home Tab Calibration)', async () => {
        // 1. 设置一个不存在的非法 Tab
        layoutStoreState.app_active_tab = 'unknown-ghost-tab'
        layoutStoreState.isMobile = false

        render(Home, { global: { mocks: { $t: k => k }, stubs: localStubs } })

        // 2. 触发 onMounted 中的校验逻辑
        await nextTick()

        // 成功点：自动回退到默认的 vault 选项卡
        expect(layoutStoreState.app_active_tab).toBe('vault')
    })
})
