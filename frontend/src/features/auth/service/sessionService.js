import { request } from '@/shared/utils/request'
import { authError } from '@/shared/utils/errors/authError'

export const sessionService = {
    /**
     * 获取当前用户所有的登录设备会话
     * @returns {Promise<{success: boolean, sessions: Array}>}
     * @throws {authError}
     */
    async getSessions() {
        try {
            return await request('/api/oauth/sessions')
        } catch (error) {
            throw new authError(error.message || '获取设备列表失败', error.status)
        }
    },

    /**
     * 删除指定的设备会话 (单点踢出)
     * @param {string} sessionId 
     * @returns {Promise<{success: boolean}>}
     * @throws {authError}
     */
    async deleteSession(sessionId) {
        try {
            return await request(`/api/oauth/sessions/${sessionId}`, {
                method: 'DELETE'
            })
        } catch (error) {
            throw new authError(error.message || '移除设备失败', error.status)
        }
    },

    /**
     * 清注销其他所有设备 (除当前设备外)
     * @returns {Promise<{success: boolean}>}
     * @throws {authError}
     */
    async deleteAllOtherSessions() {
        try {
            return await request('/api/oauth/sessions', {
                method: 'DELETE'
            })
        } catch (error) {
            throw new authError(error.message || '注销其他设备失败', error.status)
        }
    }
}
