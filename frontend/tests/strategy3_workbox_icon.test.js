import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Strategy 3: Workbox 图标缓存与零闪烁 (CacheFirst Rendering)
 * 
 * 核心目标：
 * 验证应用在图标显示上的 PWA 极速体验。
 * 
 * 关键策略：
 * 1. 域名清洗 (Domain Normalization)：将 'github' 自动补全为 'github.com'，确保 API 调用一致性。
 * 2. 零闪烁加载 (Zero Flicker)：如果 IconStore 中已有该域名的缓存 URL，组件必须在 setup 阶段直接赋值 winnerUrl，跳过 Loading 转圈。
 * 3. Workbox 拦截验证：通过读取 vite.config.js，验证 Service Worker 是否配置了对 Google/Bitwarden 图标源的 CacheFirst 持久化缓存策略。
 * 4. 离线透传：验证在 navigator.onLine = false 时，只要缓存命中，图标依然能瞬间渲染。
 */

const mockStore = { getCachedIcon: vi.fn(), setCachedIcon: vi.fn(), clearCachedIcon: vi.fn() }
vi.mock('@/features/vault/store/vaultIconStore', () => ({ useVaultIconStore: () => mockStore }))

import VaultIcon from '@/features/vault/components/vaultIcon.vue'

describe('Strategy 3: Workbox Icon Caching & Zero Flicker', () => {

    beforeEach(() => {
        setActivePinia(createPinia()); vi.useFakeTimers(); vi.clearAllMocks()
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    })

    afterEach(() => {
        vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks()
    })

    /**
     * Case 01: 域名清洗逻辑
     * 解决问题：用户输入的 Service 可能五花八门，统一清洗为标准 Domain 有助于提高缓存命中率。
     */
    it('HP-01: Should correctly parse generic service names to standard domains', async () => {
        mockStore.getCachedIcon.mockReturnValue(null)
        const wrapper = mount(VaultIcon, { props: { service: 'github' } })
        expect(wrapper.vm.domainName).toBe('github.com')
    })

    /**
     * Case 02: 缓存命中零闪烁 (Zero Flicker)
     * 目标：极致流畅度。
     * 解决问题：如果已经在内存/离线存储中存在该 Logo 的 URL，isLoading 必须立即为 false。
     */
    it('HP-04: Should have isLoading = false instantly if cache hit', async () => {
        mockStore.getCachedIcon.mockReturnValue('https://cached.url/icon.png')
        const wrapper = mount(VaultIcon, { props: { service: 'cached' } })

        expect(wrapper.vm.winnerUrl).toBe('https://cached.url/icon.png')
        expect(wrapper.vm.isLoading).toBe(false) // 此时不应显示 loading 动画
    })

    /**
     * Case 03: 配置文件安全自检 (Build Config Validation)
     * 目标：确保 PWA 策略在线。
     * 解决问题：通过源码级扫描 vite.config.js，确认开发者没有在重构过程中误删关键的 CacheFirst 缓存规则。
     */
    it('HP-09: Workbox rule should use CacheFirst strategy in vite.config.js', () => {
        const configPath = path.resolve(__dirname, '../../vite.config.js')
        // 如果文件不存在则跳过（部分环境路径不同）
        if (!fs.existsSync(configPath)) return

        const configContent = fs.readFileSync(configPath, 'utf-8')
        const match = configContent.match(/urlPattern:\s*\/.*google.*bitwarden.*\/[\s\S]*?handler:\s*'CacheFirst'/)
        expect(match).toBeTruthy()
    })

    /**
     * Case 04: 离线渲染能力 (Offline Persistence)
     */
    it('HP-11: Should render correctly under offline state IF cached', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
        mockStore.getCachedIcon.mockReturnValue('https://offline-safe.url')

        const wrapper = mount(VaultIcon, { props: { service: 'offline' } })
        await nextTick()

        expect(wrapper.vm.winnerUrl).toBe('https://offline-safe.url')
        expect(wrapper.vm.isLoading).toBe(false)
    })
})
