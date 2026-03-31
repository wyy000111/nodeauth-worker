import { request } from '@/shared/utils/request'
import { toolsError } from '@/shared/utils/errors/toolsError'

/**
 * @typedef {Object} ServerTimeResponse
 * @property {boolean} success - 请求是否成功
 * @property {number} time - 服务器时间戳 (毫秒)
 */

export const toolService = {
    /**
     * 获取服务器当前时间
     * @returns {Promise<ServerTimeResponse>}
     * @throws {toolsError}
     */
    async getServerTime() {
        try {
            return await request('/api/tools/server-time')
        } catch (error) {
            throw new toolsError(error.message || '获取服务器时间失败', error.status)
        }
    }
}
