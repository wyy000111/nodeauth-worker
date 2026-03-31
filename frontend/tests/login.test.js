/**
 * 登录页面 (Login Integration) 专项测试
 * 
 * 核心目标：
 * 验证登录页面的多方登录入口、表单交互及 WebAuthn (Passkey) 的前置兼容性检查。
 * 
 * 场景：
 * 1. OAuth 适配：验证各个主流提供商（GitHub, Google 等）在 UI 上的渲染及点击后的重定向逻辑。
 * 2. Passkey 安全反馈：针对不支持 WebAuthn 的旧版浏览器，在点击 Passkey 登录时应弹出明确的警告提示，而非静默失败。
 * 3. 登录引导：确保在成功登录后，能正确接收 UserInfo 并进行路由跳转。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import { ref } from 'vue'
import Login from '@/features/auth/views/login.vue'
import { commonStubs } from './test-utils'

// --- 模块模拟 ---

const { mockPush, mockSetUserInfo, mockWebAuthnLogin, mockT } = vi.hoisted(() => ({
    mockPush: vi.fn(),
    mockSetUserInfo: vi.fn(),
    mockWebAuthnLogin: vi.fn(),
    mockT: (key, params) => params?.provider ? `${key}:${params.provider}` : key
}))

vi.mock('vue-router', () => ({
    useRouter: () => ({ push: mockPush })
}))

vi.mock('@/locales', () => ({
    i18n: { global: { t: mockT, te: () => true, install: vi.fn() } }
}))

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: mockT }),
    createI18n: vi.fn(() => ({ global: { t: mockT } }))
}))

vi.mock('@/features/auth/store/authUserStore', () => ({
    useAuthUserStore: () => ({ setUserInfo: mockSetUserInfo })
}))

vi.mock('@/features/auth/service/webAuthnService', () => ({
    webAuthnService: {
        isSupported: vi.fn(),
        login: mockWebAuthnLogin
    }
}))

vi.mock('@/features/auth/composables/useOAuthProviders', () => ({
    useOAuthProviders: vi.fn()
}))

vi.mock('element-plus', async () => {
    const actual = await vi.importActual('element-plus')
    return {
        ...actual,
        ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn() }
    }
})

describe('Login UI Interaction Suite', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    const localStubs = {
        ...commonStubs,
        'iconGithub': true,
        'iconFingerprint': true
    }

    /**
     * Case 01: OAuth 提供商列表与响应
     * 目标：验证 OAuth2.0 入口。
     * 解决问题：防止后端增加新登录渠道时，前端 Card 无法展示或点击后无反应。
     */
    it('should show providers list and trigger handlesLogin on click', async () => {
        const { useOAuthProviders } = await import('@/features/auth/composables/useOAuthProviders')
        const handleLogin = vi.fn()

        useOAuthProviders.mockReturnValue({
            providers: ref([{ id: 'github', name: 'GitHub', color: '#000', icon: 'iconGithub' }]),
            loadingProvider: ref(null),
            isFetchingProviders: ref(false),
            handleLogin
        })

        render(Login, { global: { mocks: { $t: mockT }, stubs: localStubs } })

        // 点击 GitHub 卡片
        const githubBtn = screen.getByText(/GitHub/i).closest('button')
        await fireEvent.click(githubBtn)

        // 验证：应带着 provider ID 调用后端登录方法
        expect(handleLogin).toHaveBeenCalledWith('github')
    })

    /**
     * Case 02: 降级逻辑：不支持 Passkey 时的提示
     * 目标：验证异常分支的用户提示。
     * 解决问题：如果用户浏览器不支持 WebAuthn，点击“指纹登录”图标时必须显式弹出“当前浏览器不支持”的警告。
     */
    it('should fallback to warning if Passkey not supported', async () => {
        const { useOAuthProviders } = await import('@/features/auth/composables/useOAuthProviders')
        const { webAuthnService } = await import('@/features/auth/service/webAuthnService')
        const { ElMessage } = await import('element-plus')

        webAuthnService.isSupported.mockReturnValue(false)
        useOAuthProviders.mockReturnValue({
            providers: ref([]), loadingProvider: ref(null), isFetchingProviders: ref(false)
        })

        render(Login, { global: { mocks: { $t: mockT }, stubs: localStubs } })

        const passkeyBtn = screen.getByText(/auth\.passkey_login/i).closest('button')
        await fireEvent.click(passkeyBtn)

        expect(ElMessage.warning).toHaveBeenCalledWith('auth.passkey_not_supported')
    })
})
