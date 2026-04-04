import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import VaultItemCard from '@/features/vault/components/vaultItemCard.vue'
import { commonStubs } from './test-utils'

// --- Mocking ---

vi.mock('@/locales', () => ({
    i18n: { global: { t: (k) => k, te: () => true, install: vi.fn() } }
}))

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (k) => k }),
    createI18n: vi.fn(() => ({ global: { t: (k) => k } }))
}))

vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: vi.fn(() => ({
        isMobile: true,
        appVaultViewMode: 'card',
        appGhostMode: false
    }))
}))

const mockProps = {
    item: {
        id: '1',
        service: 'Google',
        account: 'user@gmail.com',
        secret: 'JBSWY3DPEHPK3PXP',
        period: 30,
        digits: 6
    },
    isMobile: true,
    isCompact: false,
    isSelected: false
}

describe('VaultItemCard Swipe Actions - TDD Project', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    /**
     * Case 01: 移动端视图下隐藏 Dropdown，启用预想的手势容器
     * 目标：验证在 isMobile = true 时，传统的 MoreFilled 图标（Dropdown）不再渲染，取而代之的是手势操作层。
     */
    it('should hide dropdown and show swipe surface on mobile', async () => {
        const { container } = render(VaultItemCard, {
            props: { ...mockProps, isMobile: true },
            global: {
                stubs: { ...commonStubs, VaultIcon: true },
                mocks: { $t: (k) => k }
            }
        })

        // Dropdown 应消失
        expect(container.querySelector('.more-icon')).toBeNull()

        // 预期的 SwipeAction 容器应存在 (目前代码还没写，这里会报错)
        const swipeContainer = container.querySelector('.swipe-action-container')
        expect(swipeContainer).not.toBeNull()
    })

    /**
     * Case 02: 向左轻扫 (Left Swipe) 露出“编辑”和“删除”按钮
     * 目标：模拟 touchstart 和 touchmove 事件，验证右侧操作区是否显现。
     */
    it('should reveal Edit and Delete buttons on left swipe', async () => {
        const { container } = render(VaultItemCard, {
            props: { ...mockProps, isMobile: true },
            global: {
                stubs: { ...commonStubs, VaultIcon: true },
                mocks: { $t: (k) => k }
            }
        })

        const swipeSurface = container.querySelector('.swipe-action-content')

        // 模拟向左滑动 (startX: 200, moveX: 100) -> deltaX = -100
        await fireEvent.touchStart(swipeSurface, { touches: [{ clientX: 200, clientY: 50 }] })
        await fireEvent.touchMove(swipeSurface, { touches: [{ clientX: 100, clientY: 50 }] })
        await fireEvent.touchEnd(swipeSurface)

        // 验证按钮是否在 DOM 中且可见（或具有活跃类名）
        const editBtn = screen.queryByText('common.edit')
        const deleteBtn = screen.queryByText('common.delete')
        expect(editBtn).not.toBeNull()
        expect(deleteBtn).not.toBeNull()
    })

    /**
     * Case 03: 向右轻扫 (Right Swipe) 露出“导出”按钮
     * 目标：模拟 touchstart 和 touchmove 事件，验证左侧操作区是否显现。
     */
    it('should reveal Export button on right swipe', async () => {
        const { container } = render(VaultItemCard, {
            props: { ...mockProps, isMobile: true },
            global: {
                stubs: { ...commonStubs, VaultIcon: true },
                mocks: { $t: (k) => k }
            }
        })

        const swipeSurface = container.querySelector('.swipe-action-content')

        // 模拟向右滑动 (startX: 100, moveX: 200) -> deltaX = 100
        await fireEvent.touchStart(swipeSurface, { touches: [{ clientX: 100, clientY: 50 }] })
        await fireEvent.touchMove(swipeSurface, { touches: [{ clientX: 200, clientY: 50 }] })
        await fireEvent.touchEnd(swipeSurface)

        const exportBtn = screen.queryByText('vault.export_account')
        expect(exportBtn).not.toBeNull()
    })

    /**
     * Case 04: 点击展开后的按钮应触发正确的 Emit
     * 目标：验证交互流是否闭环。
     */
    it('should emit correct command when swipe buttons are clicked', async () => {
        const { emitted, container } = render(VaultItemCard, {
            props: { ...mockProps, isMobile: true },
            global: {
                stubs: { ...commonStubs, VaultIcon: true },
                mocks: { $t: (k) => k }
            }
        })

        // 先滑开展示
        const swipeSurface = container.querySelector('.swipe-action-content')
        await fireEvent.touchStart(swipeSurface, { touches: [{ clientX: 200, clientY: 50 }] })
        await fireEvent.touchMove(swipeSurface, { touches: [{ clientX: 50, clientY: 50 }] })
        await fireEvent.touchEnd(swipeSurface)

        // 点击删除
        const deleteBtn = screen.getByText('common.delete')
        await fireEvent.click(deleteBtn)

        expect(emitted().command).toBeTruthy()
        expect(emitted().command[0]).toEqual(['delete', mockProps.item])
    })

    /**
     * Case 05: 极小位移不应触发滑动
     * 目标：防止误触。
     */
    it('should not reveal actions on tiny jitter swipe', async () => {
        const { container } = render(VaultItemCard, {
            props: { ...mockProps, isMobile: true },
            global: {
                stubs: { ...commonStubs, VaultIcon: true },
                mocks: { $t: (k) => k }
            }
        })

        const swipeSurface = container.querySelector('.swipe-action-content')

        // 模拟极小滑动 (startX: 100, moveX: 103)
        await fireEvent.touchStart(swipeSurface, { touches: [{ clientX: 100, clientY: 50 }] })
        await fireEvent.touchMove(swipeSurface, { touches: [{ clientX: 103, clientY: 50 }] })
        await fireEvent.touchEnd(swipeSurface)

        // 验证没有 .is-opened 状态类 (假设我们会用这个类)
        expect(container.querySelector('.is-opened')).toBeNull()
    })

    /**
     * Case 06: 防窥模式冲突测试
     * 目标：滑动时应抑制“长按显示代码”逻辑。
     */
    it('should prioritize swipe over ghost reveal during movement', async () => {
        const { container } = render(VaultItemCard, {
            props: { ...mockProps, isMobile: true },
            global: {
                stubs: { ...commonStubs, VaultIcon: true },
                mocks: { $t: (k) => k }
            }
        })

        const swipeSurface = container.querySelector('.swipe-action-content')
        await fireEvent.touchStart(swipeSurface, { touches: [{ clientX: 100, clientY: 50 }] })
        await fireEvent.touchMove(swipeSurface, { touches: [{ clientX: 150, clientY: 50 }] })

        expect(container.querySelector('.is-revealed')).toBeNull()
    })

    /**
     * Case 07: 震动反馈 (Haptic Feedback)
     * 目标：验证展开时触发 navigator.vibrate。
     */
    it('should trigger haptic feedback on snap open', async () => {
        if (!navigator.vibrate) {
            navigator.vibrate = vi.fn()
        }
        const vibrateSpy = vi.spyOn(navigator, 'vibrate').mockImplementation(() => true)
        const { container } = render(VaultItemCard, {
            props: { ...mockProps, isMobile: true },
            global: {
                stubs: { ...commonStubs, VaultIcon: true },
                mocks: { $t: (k) => k }
            }
        })

        const swipeSurface = container.querySelector('.swipe-action-content')
        await fireEvent.touchStart(swipeSurface, { touches: [{ clientX: 100, clientY: 50 }] })
        await fireEvent.touchMove(swipeSurface, { touches: [{ clientX: 300, clientY: 50 }] }) // 超过阈值
        await fireEvent.touchEnd(swipeSurface)

        expect(vibrateSpy).toHaveBeenCalled()
        vibrateSpy.mockRestore()
    })

    /**
     * Case 08: 单一开启策略 (Single Open Policy)
     * 目标：互斥性。打开一个卡片，另一个自动关闭。
     */
    it('should close existing open drawer when another card opens', async () => {
        // 渲染两个卡片
        const { container: containerA } = render(VaultItemCard, {
            props: { ...mockProps, item: { ...mockProps.item, id: 'A' } },
            global: { stubs: { ...commonStubs, VaultIcon: true }, mocks: { $t: (k) => k } }
        })
        const { container: containerB } = render(VaultItemCard, {
            props: { ...mockProps, item: { ...mockProps.item, id: 'B' } },
            global: { stubs: { ...commonStubs, VaultIcon: true }, mocks: { $t: (k) => k } }
        })

        // 展开 A
        const surfaceA = containerA.querySelector('.swipe-action-content')
        await fireEvent.touchStart(surfaceA, { touches: [{ clientX: 200, clientY: 50 }] })
        await fireEvent.touchMove(surfaceA, { touches: [{ clientX: 50, clientY: 50 }] })
        await fireEvent.touchEnd(surfaceA)
        expect(containerA.querySelector('.is-open')).not.toBeNull()

        // 展开 B
        const surfaceB = containerB.querySelector('.swipe-action-content')
        await fireEvent.touchStart(surfaceB, { touches: [{ clientX: 200, clientY: 50 }] })
        await fireEvent.touchMove(surfaceB, { touches: [{ clientX: 50, clientY: 50 }] })
        await fireEvent.touchEnd(surfaceB)

        // A 应自动关闭
        expect(containerA.querySelector('.is-open')).toBeNull()
    })

    /**
     * Case 09: 点击外部收起 (Click-Outside to Close)
     */
    it('should reset drawer when clicking outside', async () => {
        const { container } = render(VaultItemCard, {
            props: { ...mockProps, isMobile: true },
            global: { stubs: { ...commonStubs, VaultIcon: true }, mocks: { $t: (k) => k } }
        })

        const surface = container.querySelector('.swipe-action-content')
        await fireEvent.touchStart(surface, { touches: [{ clientX: 200, clientY: 50 }] })
        await fireEvent.touchMove(surface, { touches: [{ clientX: 50, clientY: 50 }] })
        await fireEvent.touchEnd(surface)
        expect(container.querySelector('.is-open')).not.toBeNull()

        // 模拟全局点击
        await fireEvent.touchStart(document.body)
        expect(container.querySelector('.is-open')).toBeNull()
    })

    /**
     * Case 10: 滚动锁定 (Scroll Lock)
     * 目标：确认调用了 preventDefault。
     */
    it('should call preventDefault for horizontal swipe to lock scrolling', async () => {
        const { container } = render(VaultItemCard, {
            props: { ...mockProps, isMobile: true },
            global: { stubs: { ...commonStubs, VaultIcon: true }, mocks: { $t: (k) => k } }
        })

        const surface = container.querySelector('.swipe-action-content')
        await fireEvent.touchStart(surface, { touches: [{ clientX: 200, clientY: 50 }] })

        const moveEvent = new TouchEvent('touchmove', {
            cancelable: true,
            touches: [{ clientX: 150, clientY: 50 }]
        })
        const preventSpy = vi.spyOn(moveEvent, 'preventDefault')
        surface.dispatchEvent(moveEvent)

        expect(preventSpy).toHaveBeenCalled()
    })

    /**
     * Case 11: 阈值回弹 (Snapback below Threshold)
     */
    it('should snap back if swipe distance is below threshold', async () => {
        const { container } = render(VaultItemCard, {
            props: { ...mockProps, isMobile: true },
            global: { stubs: { ...commonStubs, VaultIcon: true }, mocks: { $t: (k) => k } }
        })

        const surface = container.querySelector('.swipe-action-content')
        await fireEvent.touchStart(surface, { touches: [{ clientX: 200, clientY: 50 }] })
        await fireEvent.touchMove(surface, { touches: [{ clientX: 190, clientY: 50 }] }) // 仅移动 10px
        await fireEvent.touchEnd(surface)

        expect(container.querySelector('.is-open')).toBeNull()
    })
})
