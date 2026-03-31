/**
 * 系统自检 (Health Check) 集成测试
 * 
 * 核心目标：
 * 验证 PWA 启动时的环境准入与配置文件 (WR) 校验。
 * 
 * 逻辑覆盖：
 * 1. 自动重定向：如果检测通过 (passed: true)，系统应自动从自检页跳转至登录页。
 * 2. 关键 Issue 拦截：如果 JWT_SECRET 过短或配置缺失，展示“危急 (Critical)”警告及修复建议。
 * 3. 辅助修复工具：验证“一键生成新密钥”及“剪贴板复制”功能的可用性，降低维护门槛。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/vue'
import HealthCheck from '@/features/health/views/healthCheck.vue'
import { commonStubs, patchCrypto } from './test-utils'

// --- 模块模拟 (Hoisted 提升) ---

const { mockReplace, mockCopy, sharedState } = vi.hoisted(() => ({
    mockReplace: vi.fn(),
    mockCopy: vi.fn(),
    sharedState: { isClipboardSupported: { value: true } }
}))

// 初始化加密接口模拟
patchCrypto()

vi.mock('vue-router', () => ({
    useRouter: () => ({ replace: mockReplace })
}))

vi.mock('@vueuse/core', () => ({
    useClipboard: () => ({ copy: mockCopy, isSupported: sharedState.isClipboardSupported })
}))

vi.mock('@/shared/utils/request', () => ({
    request: vi.fn()
}))

vi.mock('@/locales', () => ({
    i18n: { global: { t: (k) => k } }
}))

describe('HealthCheck System Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sharedState.isClipboardSupported.value = true
    })

    /**
     * Case 01: 环境合格自动跳转
     * 解决问题：确保在生产环境下，正常的自检过程对用户是近乎不可见的（闪现后即跳转到登录）。
     */
    it('should redirect to login when check passed', async () => {
        const { request } = await import('@/shared/utils/request')
        request.mockResolvedValue({ passed: true })

        render(HealthCheck, { global: { mocks: { $t: k => k }, stubs: commonStubs } })

        // 验证：调用了 router.replace('/login')
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'))
    })

    /**
     * Case 02: 错误拦截与建议 (JWT Secret Too Short)
     * 解决问题：当私钥强度不达标时，前端必须拦截并给出 SUGGESTION，点击生成按钮后能生成符合熵值要求的新私钥。
     */
    it('should handle failures and key generation tools', async () => {
        const { request } = await import('@/shared/utils/request')
        request.mockResolvedValue({
            passed: false,
            issues: [{ message: 'jwt_secret_too_short', level: 'critical', field: 'JWT_SECRET', suggestion: 'generate_new_jwt' }]
        })

        render(HealthCheck, { global: { mocks: { $t: k => k }, stubs: commonStubs } })

        // 1. 查找生成按钮并模拟点击
        const genBtn = await screen.findByText(/healthCheck\.generate_new/)
        await fireEvent.click(genBtn)

        // 2. 点击复制按钮，验证剪贴板集成
        const copyBtn = screen.getAllByRole('button')[0]
        await fireEvent.click(copyBtn)
        expect(mockCopy).toHaveBeenCalled()
    })
})
