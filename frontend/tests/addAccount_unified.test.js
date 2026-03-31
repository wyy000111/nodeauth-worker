import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { menuItems } from '@/features/home/constants/navigation'

/**
 * 统一添加账号入口 (Add Account Unification) 专项测试
 * 
 * 核心目标：
 * 验证对旧版“扫码/手动/文件”三个独立 Tab 的重构统一性。
 * 现在的设计是将所有添加方式整合在单个页面，减少用户的认知负担。
 * 
 * 验证重点：
 * 1. 扁平化菜单 (Flat Menu)：确保侧边栏菜单不再有子层级，而是一个直达入口。
 * 2. 导航继承 (Auto-Back)：进入“添加”页面后，其 Breadcrumb 父级应自动识别为“金库首页 (Vault)”，确保回退按钮逻辑正确。
 * 3. 旧版路由拦截：验证原本的 `add-vault-scan` 等旧路由已失效或映射到新入口，防止书签失效。
 */

describe('Add Account Unification - UX Simplification', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    describe('Navigation Structure: Flat over Tree', () => {
        /**
         * Case 01: 验证侧边栏菜单配置
         * 解决问题：旧版菜单是树形结构，点击“添加”会展开子项。新版要求点击“添加”直接跳转。
         */
        it('should have a single "add-vault" menu item without children', () => {
            const addVaultMenu = menuItems.find(item => item.key === 'add-vault')
            expect(addVaultMenu).toBeDefined()

            // 关键：重构后 add-vault 不应再有 children 数组
            expect(addVaultMenu.children).toBeUndefined()
        })
    })

    describe('Layout Store: Path Inheritance', () => {
        /**
         * Case 02: 验证回退层级映射 (Hierarchical Mapping)
         * 解决问题：确保在添加页面点“返回”是回到 Vault 列表，而不是回到 Home 或 Login。
         */
        it('should have "add-vault" as a child of "vault"', () => {
            const layoutStore = useLayoutStore()
            layoutStore.setActiveTab('add-vault')

            // 验证：此时应当判定为可回退
            expect(layoutStore.canGoBack).toBe(true)

            layoutStore.goBack()
            // 验证：回跳目标精准匹配金库页
            expect(layoutStore.app_active_tab).toBe('vault')
        })

        /**
         * Case 03: 旧功能清理 (Cleanup Validation)
         * 解决问题：确保废弃的 add-vault-scan 等 Key 不再污染当前的导航树。
         */
        it('should no longer support legacy add-vault-scan tab', () => {
            const layoutStore = useLayoutStore()
            layoutStore.setActiveTab('add-vault-scan')

            // 由于该 Key 已被移除，它不应具有自动回退到 vault 的能力
            expect(layoutStore.canGoBack).toBe(false)
        })
    })
})
