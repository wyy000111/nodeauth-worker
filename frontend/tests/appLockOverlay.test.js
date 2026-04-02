/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AppLockOverlay from '../src/features/applock/components/appLockOverlay.vue'
import { useAppLockStore } from '../src/features/applock/store/appLockStore'

// Mock store instance
const mockStore = {
    isLocked: true,
    lockMode: 'biometric',
    isUnlocking: false,
    unlockWithBiometric: vi.fn(),
    unlockWithPin: vi.fn()
}

// Mock dependencies
vi.mock('element-plus', async () => {
    const actual = await vi.importActual('element-plus')
    return {
        ...actual,
        ElMessage: { success: vi.fn(), error: vi.fn() },
        ElMessageBox: { confirm: vi.fn().mockResolvedValue('confirm') }
    }
})

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key) => key }),
    createI18n: () => ({ global: { t: (key) => key, locale: { value: 'en-US' } } })
}))

vi.mock('vue-router', () => ({
    useRoute: () => ({ path: '/', meta: { requiresAuth: true } }),
    useRouter: () => ({ push: vi.fn() })
}))

vi.mock('../src/features/applock/store/appLockStore', () => ({
    useAppLockStore: vi.fn(() => mockStore)
}))

vi.mock('../src/features/auth/store/authUserStore', () => ({
    useAuthUserStore: vi.fn(() => ({
        userInfo: { username: 'test-user' },
        logout: vi.fn().mockResolvedValue(true)
    }))
}))

describe('AppLockOverlay Architectural Refactored Test', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        setActivePinia(createPinia())
        vi.clearAllMocks()

        mockStore.isLocked = true
        mockStore.lockMode = 'biometric'
        mockStore.isUnlocking = false
        mockStore.unlockWithBiometric.mockResolvedValue(false)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('should call store.unlockWithBiometric(false) automatically on mount', async () => {
        mount(AppLockOverlay, {
            global: {
                mocks: { $t: (key) => key },
                stubs: { 'el-icon': true, 'Fingerprint': true, 'Lock': true, 'Back': true, 'transition': false }
            }
        })

        // 我们在组件内设置了 300ms 延迟以确保 UI 平滑
        await vi.advanceTimersByTimeAsync(400)

        // 验证：自动唤起时必须传 false
        expect(mockStore.unlockWithBiometric).toHaveBeenCalledWith(false)
        expect(mockStore.unlockWithBiometric).toHaveBeenCalledTimes(1)
    })

    it('should call store.unlockWithBiometric(true) when clicking the fingerprint icon', async () => {
        const wrapper = mount(AppLockOverlay, {
            global: {
                mocks: { $t: (key) => key },
                stubs: { 'el-icon': true, 'Fingerprint': true, 'Lock': true, 'Back': true, 'transition': false }
            }
        })

        const btn = wrapper.find('.btn-extra')
        await btn.trigger('click')

        // 验证：手动点击必须传 true，由 Store 内部决定是否强制重置
        expect(mockStore.unlockWithBiometric).toHaveBeenCalledWith(true)
    })

    it('should handle pin entry and call store.unlockWithPin', async () => {
        const wrapper = mount(AppLockOverlay, {
            global: {
                mocks: { $t: (key) => key },
                stubs: { 'el-icon': true, 'Fingerprint': true, 'Lock': true, 'Back': true, 'transition': false }
            }
        })

        // 输入 6 位 PIN
        const keys = wrapper.findAll('.keypad button:not(.btn-extra)')
        for (let i = 0; i < 6; i++) {
            await keys[i].trigger('click')
        }

        // 验证 PIN 提交
        expect(mockStore.unlockWithPin).toHaveBeenCalledWith('123456')
    })
})
