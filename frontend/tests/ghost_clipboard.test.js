import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { copyToClipboard } from '@/shared/utils/common'
import VaultItemCard from '@/features/vault/components/vaultItemCard.vue'

/**
 * Feature: Ghost Mode & Auto Protection (防窥屏与隐私保护)
 * 
 * 核心目标：
 * 验证应用在高度隐私场景下的交互逻辑。
 * 
 * 关键策略：
 * 1. 防窥模式 (Ghost Mode)：验证 Code 长按显影、松开遮挡的逻辑，防止公共场合一屏 2FA 码全露。
 * 2. 剪贴板粉碎机 (Active Destruction)：验证复制 Code 后，60 秒自动清空剪贴板，防止其他应用窃取剪贴板内容。
 * 3. 误触防御：验证长按过程中的“位移判定”，如果用户在滑动屏幕，不应意外触发 Code 显影。
 */

vi.mock('@/locales', () => ({
    i18n: { global: { t: (key) => key } }
}))

vi.mock('element-plus', async (importOriginal) => {
    const actual = await importOriginal()
    const ElMessage = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() })
    return { ...actual, ElMessage, ElMessageBox: { confirm: vi.fn() } }
})

Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue() }
})

describe('Feature: Ghost Mode - Interactive Privacy', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        localStorage.clear()
        vi.clearAllMocks()
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    /**
     * Case 01: 防窥模式的开启与持久化
     */
    it('should toggle ghost mode in store and save to localStorage', () => {
        const layoutStore = useLayoutStore()
        layoutStore.setGhostMode(true)
        expect(localStorage.getItem('app_ghost_mode')).toBe('true')
    })

    /**
     * Case 02: 显影逻辑与计时器回收 (Release-to-Reveal)
     * 目标：验证“松开即显影”及其自动恢复逻辑。
     * 解决问题：显影状态应在 30 秒后自动恢复为模糊，防止用户忘记遮挡。
     */
    it('should apply is-ghost-mode class and handle reveal/autohide', async () => {
        const layoutStore = useLayoutStore()
        layoutStore.setGhostMode(true)

        const wrapper = mount(VaultItemCard, {
            props: { item: { id: 'test1', service: 'Binance', secret: 'ABC' } },
            global: {
                mocks: { $t: (k) => k },
                stubs: { 'el-card': { template: '<div><slot /></div>' }, 'VaultIcon': true, 'el-icon': true, 'el-dropdown': true, 'el-progress': true }
            }
        })

        expect(wrapper.classes()).toContain('is-ghost-mode')
        const area = wrapper.find('.code-display-area')

        // 模拟交互：长按 -> 松开
        await area.trigger('touchstart', { touches: [{ clientX: 100, clientY: 100 }] })
        await area.trigger('touchend', { changedTouches: [{ clientX: 100, clientY: 100 }] })

        expect(wrapper.classes()).toContain('is-revealed') // 显影成功

        // 推进 31 秒后自动重新变回 Ghost 模糊态
        await vi.advanceTimersByTimeAsync(31000)
        await wrapper.vm.$nextTick()
        expect(wrapper.classes()).not.toContain('is-revealed')
    })

    /**
     * Case 03: 滑动屏幕不显影 (Prevention)
     * 解决问题：如果用户的手指位移超过 10px，代表他们在上下翻页而不是想看 Code，应取消显影指令。
     */
    it('[Edge Case] should NOT reveal if hand moves significantly (scroll gesture prevention)', async () => {
        const layoutStore = useLayoutStore()
        layoutStore.setGhostMode(true)
        const wrapper = mount(VaultItemCard, {
            props: { item: { id: 't1', secret: 'A' } },
            global: {
                mocks: { $t: k => k },
                stubs: {
                    'el-card': { template: '<div><slot /></div>' },
                    'VaultIcon': true,
                    'el-icon': true,
                    'el-dropdown': true,
                    'el-progress': true
                }
            }
        })

        const area = wrapper.find('.code-display-area')
        await area.trigger('touchstart', { touches: [{ clientX: 100, clientY: 100 }] })

        // 模拟位移 100px (代表滑动)
        await area.trigger('touchend', { changedTouches: [{ clientX: 200, clientY: 100 }] })

        expect(wrapper.classes()).not.toContain('is-revealed')
    })
})

describe('Feature: Active Clipboard Destruction', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    /**
     * Case 04: 剪贴板自动粉碎 (Auto-Wipe)
     * 目标：最小化攻击面。
     * 解决问题：复制 2FA 验证码后，如果不及时清理，任何读取剪贴板的恶意 APP 都能拿到该码。系统应在 60 秒后覆盖剪贴板内容为一个空格。
     */
    it('should copy text and wipe after 60s silence', async () => {
        await copyToClipboard('123456')
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('123456')

        // 推进 60 秒
        vi.advanceTimersByTime(60000)

        // 验证：剪贴板内容被粉碎（写入一个空格）
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(' ')
    })
})
