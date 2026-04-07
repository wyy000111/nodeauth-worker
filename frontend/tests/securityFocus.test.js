import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/vue'
import { nextTick } from 'vue'
import securitySettings from '@/features/settings/views/securitySettings.vue'
import { createTestingPinia } from '@pinia/testing'
import { useAppLockStore } from '@/features/applock/store/appLockStore'
import { useLayoutStore } from '@/features/home/store/layoutStore'

// 基础 Mock
vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: vi.fn(() => ({ isMobile: true }))
}))

vi.mock('@/features/applock/store/appLockStore', () => ({
    useAppLockStore: vi.fn()
}))

vi.mock('@/features/auth/store/authUserStore', () => ({
    useAuthUserStore: vi.fn(() => ({
        userInfo: { username: 'test' }
    }))
}))

vi.mock('@/locales', () => ({
    i18n: { global: { t: (k) => k } }
}))

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (k) => k }),
    createI18n: () => ({})
}))

vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn() }),
    useRoute: () => ({ meta: {} })
}))

vi.mock('@/shared/utils/idb', () => ({
    getIdbItem: vi.fn(() => Promise.resolve(null)),
    setIdbItem: vi.fn(() => Promise.resolve()),
    removeIdbItem: vi.fn(() => Promise.resolve())
}))

describe('Security Settings Focus Integration Test (TDD)', () => {
    let pinia

    beforeEach(() => {
        pinia = createTestingPinia({
            createSpy: vi.fn,
            initialState: {
                appLock: { lockMode: 'none' },
                layout: { isMobile: true }
            }
        })

        useLayoutStore.mockReturnValue({ isMobile: true })
    })

    const ResponsiveOverlayStub = {
        props: ['modelValue'],
        template: '<div v-if="modelValue" class="overlay-stub"><slot /></div>',
        emits: ['opened'],
        mounted() {
            process.nextTick(() => this.$emit('opened'))
        }
    }

    const ContainerStub = { template: '<div><slot /></div>' }

    it('Scenario 1: Setup PIN - Focus verification', async () => {
        useAppLockStore.mockReturnValue({
            lockMode: 'none',
            setupPin: vi.fn()
        })

        const { getByText, container } = render(securitySettings, {
            global: {
                plugins: [pinia],
                mocks: { $t: k => k },
                stubs: {
                    'el-icon': ContainerStub,
                    'el-card': ContainerStub,
                    'el-tag': ContainerStub,
                    'el-switch': true,
                    'el-select': true, 'el-option': true, 'el-avatar': true,
                    'el-button': { template: '<button @click="$emit(\'click\')"><slot /></button>' },
                    'ResponsiveOverlay': ResponsiveOverlayStub
                }
            }
        })

        // 1. 点击设置按钮
        const setupBtn = getByText('common.setup')
        await fireEvent.click(setupBtn)

        // 2. 等待
        await new Promise(resolve => setTimeout(resolve, 50))
        await nextTick()

        // 3. 验证聚焦
        const input = container.querySelector('input[type="password"]')
        expect(input).toBeTruthy()
        expect(document.activeElement).toBe(input)
    })

    it('Scenario 2: Disable PIN - Focus verification', async () => {
        useAppLockStore.mockReturnValue({
            lockMode: 'pin',
            disableLock: vi.fn()
        })

        const { getByText, container } = render(securitySettings, {
            global: {
                plugins: [pinia],
                mocks: { $t: k => k },
                stubs: {
                    'el-icon': ContainerStub,
                    'el-card': ContainerStub,
                    'el-tag': ContainerStub,
                    'el-switch': true,
                    'el-select': true, 'el-option': true, 'el-avatar': true,
                    'el-button': { template: '<button @click="$emit(\'click\')"><slot /></button>' },
                    'ResponsiveOverlay': ResponsiveOverlayStub
                }
            }
        })

        // 1. 寻找停用按钮
        const disableBtn = getByText('common.disable')
        await fireEvent.click(disableBtn)

        await new Promise(resolve => setTimeout(resolve, 50))
        await nextTick()

        // 2. 检查输入框聚焦
        const input = container.querySelector('input[placeholder="••••••"]')
        expect(input).toBeTruthy()
        expect(document.activeElement).toBe(input)
    })
})
