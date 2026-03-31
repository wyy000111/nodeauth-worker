/**
 * 资源加载体验 (Modern UX: Resource Loading) 专项测试
 * 
 * 核心目标：
 * 验证 PWA 环境下异步组件加载的“抗抖动”与“抗网络异常”能力。
 * 
 * 关键策略：
 * 1. 自动重试系统 (Resilient Retry)：当由于移动端网络切换导致的分包加载失败 (ChunkLoadError) 时，系统必须自动重试 3 次，每次间隔 500ms。
 * 2. 加载条防闪烁 (Anti-Flicker)：如果资源加载在 200ms 内完成（弱网瞬间恢复或强网），不应展示 Loading UI。
 * 3. 失败降级显示：所有重试耗尽后，展示统一的失败 UI，并提供“点击重试”入口。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { createAsyncComponent } from '@/shared/utils/asyncHelper'
import { commonStubs, i18nMocks } from './test-utils'

vi.mock('@/locales', () => ({ i18n: { global: { t: (key) => key } } }))

describe('Async Infrastructure - Pulse & Retry System', () => {
    beforeEach(() => {
        vi.useFakeTimers(); vi.clearAllMocks()
    })

    const createContainer = (AsyncComp) => defineComponent({
        render() { return h('div', { id: 'test-container' }, [h(AsyncComp)]) }
    })

    /**
     * Case 01: 验证 3 次重试逻辑
     * 解决问题：移动端网络极不稳定。必须保证资源下载具备自愈能力。
     */
    it('should retry 3 times and eventually show error UI', async () => {
        let loadCount = 0
        const mockLoader = vi.fn().mockImplementation(async () => {
            loadCount++
            throw new Error('ChunkLoadError')
        })

        const AsyncComp = createAsyncComponent(mockLoader)
        const wrapper = mount(createContainer(AsyncComp), { global: { stubs: commonStubs, mocks: i18nMocks } })

        // 尝试 1
        await flushPromises(); expect(loadCount).toBe(1)

        // 推进延迟 600ms -> 触发重试 2
        await vi.advanceTimersByTimeAsync(600); await flushPromises()
        expect(loadCount).toBe(2)

        // 再次推进 -> 触发重试 3
        await vi.advanceTimersByTime(600); await flushPromises()
        expect(loadCount).toBe(3)

        // 重试 3 次均失败后，验证错误 UI 占位
        await vi.advanceTimersByTimeAsync(100); await flushPromises(); await nextTick()
        expect(wrapper.get('#test-container').text()).toContain('common.loading_failed')
    })

    /**
     * Case 02: 200ms 防闪烁屏障
     * 解决问题：强网环境下，瞬间加载完毕不应出现 Loading 转圈，提升高级感。
     */
    it('should show loading bar ONLY after 200ms threshold', async () => {
        const mockLoader = () => new Promise(() => { }) // 挂起模式
        const AsyncComp = createAsyncComponent(mockLoader)
        const wrapper = mount(createContainer(AsyncComp), { global: { stubs: commonStubs, mocks: i18nMocks } })

        // 刚开始时不显示加载条
        expect(wrapper.find('.async-progress-bar').exists()).toBe(false)

        // 到达阈值 200ms 以后
        await vi.advanceTimersByTimeAsync(300); await flushPromises(); await nextTick()

        // 现在应该出现了
        expect(wrapper.find('.async-progress-bar').exists()).toBe(true)
    })
})
