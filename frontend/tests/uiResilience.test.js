/**
 * 图标自适应与容灾 (VaultIcon UI Resilience) 集成测试
 * 
 * 核心目标：
 * 验证 PWA 应用在不同质量 CDN 和网络抖动下，图标加载的“谁快选谁”与“兜底回退”逻辑。
 * 
 * 验证重点：
 * 1. 竞速加载机制 (Racing Probe)：同时从 Google / DuckDuckGo 等多个源探测 Logo，谁先返回且质量达标就显示谁。
 * 2. 低保真过滤 (Low Fidelity Filter)：拦截 16px 的默认地球图标，强制触发 Fallback 或继续等待高质量源。
 * 3. 超时强降级 (Absolute Fallback)：在网络完全阻塞 6 秒后，自动显示对应的服务首字母作为占位，保障金库不处于“转圈”状态。
 * 4. 离线缓存优先：验证一旦一个图标被确认可用并存入 IconStore，下次加载应实现 O(0) 的瞬间渲染。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import VaultIcon from '@/features/vault/components/vaultIcon.vue'
import { useVaultIconStore } from '@/features/vault/store/vaultIconStore'

// --- Image 模拟：控制图片的加载时机与 naturalWidth 属性 ---
const { activeImages } = vi.hoisted(() => ({ activeImages: [] }))
global.Image = class {
    constructor() {
        this.onload = null; this.onerror = null; this.naturalWidth = 0; this._src = ''
        activeImages.push(this)
    }
    set src(val) { this._src = val }
    get src() { return this._src }
}

describe('VaultIcon UI Resilience - Racing Logic & Fallback', () => {
    beforeEach(() => {
        setActivePinia(createPinia()); vi.useFakeTimers()
        activeImages.length = 0; localStorage.clear()
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
        vi.clearAllMocks()
    })

    const triggerWait = async (ms = 100) => {
        await vi.advanceTimersByTimeAsync(ms); await flushPromises()
    }

    /**
     * Case 01: 过滤模糊图标 (Quality Logic)
     * 解决问题：Google Favicon 服务常在找不到 Logo 时会返回一张极小的透明图或默认地球图。
     * 组件必须识别这些 naturalWidth < 24px 的无效响应，并继续等待其他源或最终降级。
     */
    it('should reject a 16px placeholder and show fallback', async () => {
        const wrapper = mount(VaultIcon, { props: { service: 'Google', size: 32 } })

        await triggerWait(500) // 开启竞争探测

        // 模拟所有探测到的图片均为 16px 低质量图
        activeImages.forEach(img => {
            img.naturalWidth = 16
            if (img.onload) img.onload()
        })

        await triggerWait(6500) // 推进到 6s 超时点

        // 验证：应当显示文字占位 (G) 而不是模糊的图片
        expect(wrapper.find('.service-icon-fallback').exists()).toBe(true)
        expect(wrapper.text()).toContain('G')
    })

    /**
     * Case 02: 竞速响应成功 (Winner Picks)
     */
    it('should show image when high-quality source (>=24px) resolves', async () => {
        const wrapper = mount(VaultIcon, { props: { service: 'GitHub', size: 32 } })
        await triggerWait(500)

        // 模拟 Google 源返回 64px 优质图
        const winner = activeImages.find(img => img.src.includes('google'))
        if (winner) {
            winner.naturalWidth = 64
            if (winner.onload) winner.onload({ target: winner })
        }

        await flushPromises(); await wrapper.vm.$nextTick()

        // 验证：显示图标成功并存入 Store 缓存
        expect(wrapper.find('.service-icon-img').exists()).toBe(true)
        const iconStore = useVaultIconStore()
        expect(iconStore.getCachedIcon('github.com')).toBeTruthy()
    })

    /**
     * Case 03: 灾难性网络兜底 (Kill-Switch)
     * 解决问题：确保在极其恶劣的弱网下，图标不会阻碍用户对金库的正常操作。
     */
    it('should display initial letter fallback after 6s of silence', async () => {
        const wrapper = mount(VaultIcon, { props: { service: 'SlowNet', size: 32 } })
        await triggerWait(7000)
        expect(wrapper.find('.service-icon-fallback').exists()).toBe(true)
        expect(wrapper.text()).toContain('S')
    })
})
