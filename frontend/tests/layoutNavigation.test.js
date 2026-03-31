import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLayoutStore } from '@/features/home/store/layoutStore'

/**
 * Layout Navigation (界面导航层级) 测试
 * 
 * 核心目标：
 * 验证 PWA 应用在移动端/桌面端下的“深层导航”与“面包屑/回退”逻辑。
 * 对于多层嵌套的设置页面（如 Settings -> Appearance -> Layout），必须确保层级关系正确，以便显示回退按钮。
 * 
 * 验证重点：
 * 1. 自动回退识别 (canGoBack)：当进入二级或更深级页面时，LayoutStore 应自动判定为可回退状态。
 * 2. 导航回弹路径：确保点一下“返回”能回到逻辑上一级，而不是直接出局。
 */

describe('Layout Navigation Layer Logic', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    /**
     * Case 01: 导航深度识别 (canGoBack)
     * 目标：验证子页面面包屑逻辑。
     * 解决问题：确保在“外观设置 (Appearance)”中点击“布局配置 (Layout)”后，顶部栏能正确显示回退箭头。
     */
    it('NAV_HIERARCHY: settings-layout should have mobile-settings as parent', () => {
        const layoutStore = useLayoutStore()

        // 模拟用户点击进入了布局设置页
        layoutStore.setActiveTab('settings-layout')

        // 由于 settings-layout 有父级，canGoBack 应当为 true
        expect(layoutStore.canGoBack).toBe(true)
    })

    /**
     * Case 02: 逻辑返回路径
     * 目标：验证返回栈的正确性。
     * 解决问题：点击返回时，系统应根据定义好的 parent 关系精准跳转到上一级菜单。
     */
    it('goBack(): should navigate back to settings-appearance from settings-layout', () => {
        const layoutStore = useLayoutStore()
        layoutStore.setActiveTab('settings-layout')

        // 执行统一的返回动作
        layoutStore.goBack()

        // 断言：应当重置 app_active_tab 为父级 'settings-appearance'
        expect(layoutStore.app_active_tab).toBe('settings-appearance')
    })
})
