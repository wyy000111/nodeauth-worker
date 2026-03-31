import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTimeSync } from '@/features/tools/composables/useTimeSync'

/**
 * Strategy 5: 离线时钟同步降级 (Offline Time Sync)
 * 
 * 核心目标：
 * 验证 PWA 在无法连接服务器时，如何利用本地持久化的 Time Offset 保证 TOTP 算力。
 * 
 * 关键策略：
 * 1. 在线同步 (Online Sync)：成功获取服务器时间后，计算本地与服务器的 ms 差值，并持久化到 LocalStorage。
 * 2. 离线回退 (Offline Fallback)：当检测到 navigator.onLine = false 时，不再尝试请求后端，而是直接返回 localStorage.getItem('app_time_offset')，确保 TOTP 秒级校准。
 * 3. 容错边界：如果没有网络且本地也没有缓存 Offset，系统应明确返回失败 (success: false)，并引导用户连网。
 */

// --- 模块模拟 ---

vi.mock('@/features/tools/service/toolService', () => ({
    toolService: { getServerTime: vi.fn() }
}))
import { toolService } from '@/features/tools/service/toolService'

vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: vi.fn(() => ({ isOffline: !navigator.onLine }))
}))

vi.mock('@/locales', () => ({ i18n: { global: { t: (key) => key } } }))

describe('Strategy 5: Offline Time Sync Fallback & Persistence', () => {
    beforeEach(() => {
        setActivePinia(createPinia()); localStorage.clear(); vi.clearAllMocks(); vi.useFakeTimers()
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    })

    afterEach(() => { vi.useRealTimers() })

    /**
     * Case 01: 在线同步与持久化
     * 解决问题：确保校准一次后，偏置值能存入盘阵，供下次启动使用。
     */
    it('HP-01: Online sync should save offset to localStorage', async () => {
        const now = Date.now()
        // 模拟服务器比本地快 5 秒
        toolService.getServerTime.mockResolvedValue({ success: true, time: now + 5000 })

        const { syncTime } = useTimeSync()
        const result = await syncTime()

        expect(result.success).toBe(true)
        expect(localStorage.getItem('app_time_offset')).toBe(String(result.offset))
    })

    /**
     * Case 02: 离线冷启动恢复
     * 解决问题：彻底断网时打开 APP，金库应能自动加载上一次的 Offset，保证 2FA 码在离线时也是准的。
     */
    it('HP-02: Initializing while OFFLINE should restore offset from localStorage', () => {
        localStorage.setItem('app_time_offset', '12345')
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

        const { offset } = useTimeSync()
        expect(offset.value).toBe(12345) // 成功从持久化层恢复
    })

    /**
     * Case 03: 离线同步请求静默 (Quiet Fallback)
     * 解决问题：离线点击“同步按钮”不应报错，而应瞬间返回本地缓存值，提升响应速度体验。
     */
    it('HP-03: Syncing while offline returns success with cached offset instantly', async () => {
        localStorage.setItem('app_time_offset', '9999')
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

        const { syncTime } = useTimeSync()
        const result = await syncTime()

        // 验证：不发起 API 请求
        expect(toolService.getServerTime).not.toHaveBeenCalled()
        expect(result.offlineFallback).toBe(true)
        expect(result.offset).toBe(9999)
    })
})
