/**
 * 认证与授权模块专用的异常类
 */
export class authError extends Error {
    /**
     * @param {string} message - 错误描述
     * @param {number|string} [code] - 错误代码或 HTTP 状态码
     */
    constructor(message, code = 'AUTH_ERR') {
        super(message)
        this.name = 'authError'
        this.code = code
    }
}
