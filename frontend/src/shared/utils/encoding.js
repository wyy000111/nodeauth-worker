/**
 * 基础编码转换辅助工具
 */

export function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
    }
    return bytes
}

export function base64ToBytes(base64) {
    const binStr = atob(base64)
    const bytes = new Uint8Array(binStr.length)
    for (let i = 0; i < binStr.length; i++) {
        bytes[i] = binStr.charCodeAt(i)
    }
    return bytes
}

export function tryParseJSON(str) {
    try {
        return JSON.parse(str)
    } catch (e) {
        return null
    }
}
