/**
 * 工具模块专用的异常类
 */
export class toolsError extends Error {
    /**
     * @param {string} message - 错误描述
     * @param {number|string} [code] - 错误代码或 HTTP 状态码
     */
    constructor(message, code = 'TOOLS_ERR') {
        super(message)
        this.name = 'toolsError'
        this.code = code
    }
}
