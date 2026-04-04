/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Mock dependencies of components to avoid complex import chains
vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: vi.fn(() => ({
        isMobile: false,
        appGhostMode: false
    }))
}))

// Mock appLockStore
vi.mock('../src/features/applock/store/appLockStore', () => ({
    useAppLockStore: vi.fn(() => ({
        isLocked: true,
        lockMode: 'pin'
    }))
}))

// Mock authUserStore
vi.mock('../src/features/auth/store/authUserStore', () => ({
    useAuthUserStore: vi.fn(() => ({
        userInfo: { username: 'test' }
    }))
}))

vi.mock('vue-router', () => ({
    useRoute: () => ({ path: '/', meta: { requiresAuth: true } }),
    useRouter: () => ({ push: vi.fn() })
}))

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (k) => k }),
    createI18n: () => ({
        global: { t: (k) => k, locale: { value: 'en-US' } },
        install: () => { }
    })
}))

// Components to test
import ResponsiveOverlay from '../src/shared/components/responsiveOverlay.vue'

describe('Z-Index Layering Architectural Verification', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    describe('Design Tokens Consistency', () => {
        it('should have correct z-index tokens defined in variables.css', () => {
            const cssPath = resolve(__dirname, '../src/app/styles/modules/base/variables.css')
            const cssContent = readFileSync(cssPath, 'utf-8')

            expect(cssContent).toContain('--z-index-lock: 10000')
            expect(cssContent).toContain('--z-index-privacy: 99999')
            expect(cssContent).toContain('--z-index-overlay: 2000')
            expect(cssContent).toContain('--z-index-toast: 5000')
            expect(cssContent).toContain('--z-index-shell: 9500')
        })
    })

    describe('Global Style Regression (Regex Check)', () => {
        it('should not have remaining hardcoded high z-index values in critical CSS modules', () => {
            const filesToCheck = [
                '../src/app/styles/modules/layout/mobile.css',
                '../src/app/styles/modules/components/security.css',
                '../src/app/styles/modules/layout/containers.css',
                '../src/app/styles/modules/components/shared.css'
            ]

            filesToCheck.forEach(file => {
                const path = resolve(__dirname, file)
                const content = readFileSync(path, 'utf-8')

                const hardcodedHighZ = content.match(/z-index\s*:\s*(99999|9999|5000|3500|10000)\s*;/)
                expect(hardcodedHighZ, `File ${file} still contains hardcoded z-index`).toBeNull()
            })
        })
    })

    describe('Component Level Implementation', () => {
        it('ResponsiveOverlay should provide z-index 2000 in desktop mode', async () => {
            const { useLayoutStore } = await import('@/features/home/store/layoutStore')
            vi.mocked(useLayoutStore).mockReturnValue({ isMobile: false })

            const desktopWrapper = mount(ResponsiveOverlay, {
                props: { modelValue: true, title: 'Test' },
                global: {
                    stubs: { 'el-dialog': true, 'el-drawer': true }
                }
            })

            expect(desktopWrapper.vm.componentProps['z-index']).toBe(2000)
        })

        it('ResponsiveOverlay should provide z-index 2000 in mobile mode', async () => {
            const { useLayoutStore } = await import('@/features/home/store/layoutStore')
            vi.mocked(useLayoutStore).mockReturnValue({ isMobile: true })

            const mobileWrapper = mount(ResponsiveOverlay, {
                props: { modelValue: true, title: 'Test' },
                global: {
                    stubs: { 'el-dialog': true, 'el-drawer': true }
                }
            })

            expect(mobileWrapper.vm.componentProps['z-index']).toBe(2000)
        })

        it('AppLockOverlay component source verification', () => {
            const overlayPath = resolve(__dirname, '../src/features/applock/components/appLockOverlay.vue')
            const content = readFileSync(overlayPath, 'utf-8')
            expect(content).toContain('z-index: var(--z-index-lock)')
        })
    })
})
