import { request } from '@/shared/utils/request'
import { authError } from '@/shared/utils/errors/authError'

/**
 * @typedef {Object} OAuthProvider
 * @property {string} id - 提供商标识 (如 'github', 'telegram')
 * @property {string} name - 提供商显示名称
 * @property {string} [icon] - SVG 图标
 * @property {string} [color] - 品牌主色调
 */

/**
 * @typedef {Object} AuthorizeResponse
 * @property {boolean} success - 是否成功
 * @property {string} authUrl - 授权跳转链接
 * @property {string} state - 随机状态码 (CSRF防御)
 * @property {string} [codeVerifier] - PKCE验证码
 * @property {string} [error] - 错误信息
 */

/**
 * @typedef {Object} LoginResponse
 * @property {boolean} success - 是否成功
 * @property {string} [deviceKey] - 设备指纹标识 (用于后续验证)
 * @property {string} [error] - 错误信息
 */

export const authService = {
    /**
     * 获取系统当前支持的 OAuth 登录提供商列表
     * @returns {Promise<{success: boolean, providers: OAuthProvider[]}>}
     * @throws {authError}
     */
    async getProviders() {
        try {
            return await request('/api/oauth/providers')
        } catch (error) {
            throw new authError(error.message || '获取登录方式失败', error.status)
        }
    },

    /**
     * 获取指定提供商的授权重定向地址
     * @param {string} providerId - 提供商 ID
     * @returns {Promise<AuthorizeResponse>}
     * @throws {authError}
     */
    async getAuthorizeUrl(providerId) {
        try {
            return await request(`/api/oauth/authorize/${providerId}`)
        } catch (error) {
            throw new authError(error.message || '获取授权链接失败', error.status)
        }
    },

    /**
     * 回调阶段：使用授权码 (Code) 兑换系统 JWT
     * @param {string} providerId - 提供商 ID
     * @param {Object} payload - 需要验证的载荷 (如 code, state, codeVerifier, hash)
     * @returns {Promise<LoginResponse>}
     * @throws {authError}
     */
    async loginWithToken(providerId, payload) {
        try {
            const { getDeviceId } = await import('@/shared/utils/device')
            const finalPayload = { ...payload, deviceId: getDeviceId() }

            return await request(`/api/oauth/callback/${providerId}`, {
                method: 'POST',
                body: JSON.stringify(finalPayload)
            })
        } catch (error) {
            throw new authError(error.message || '登录验证失败', error.status)
        }
    },

    /**
     * 退出登录，注销服务端 Session/Token
     * @returns {Promise<{success: boolean}>}
     */
    async logout() {
        try {
            return await request('/api/oauth/logout', { method: 'POST' })
        } catch (error) {
            console.error('Logout request failed', error)
            return { success: false }
        }
    },

    /**
     * 获取当前登录用户信息
     * @returns {Promise<{success: boolean, userInfo?: Object}>}
     */
    async fetchMe() {
        try {
            // 加入时间戳防缓存，silent: true 防止请求拦截器弹出 message
            return await request(`/api/oauth/me?_t=${Date.now()}`, { silent: true })
        } catch (error) {
            return { success: false }
        }
    },

    /**
     * 确认系统初始化已完成 (验证并激活)
     * @param {string} lastFour - Key 的最后 4 位
     */
    async confirmEmergency(lastFour) {
        try {
            return await request('/api/emergency/confirm', {
                method: 'POST',
                body: JSON.stringify({ lastFour })
            })
        } catch (error) {
            throw new authError(error.message || '系统确认失败', error.status)
        }
    }
}
