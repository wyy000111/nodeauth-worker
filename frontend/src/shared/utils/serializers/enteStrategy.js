import { argon2id } from 'hash-wasm'
import { parseOtpUri } from '@/shared/utils/totp'
import { loadResource } from '@/shared/services/offlineRegistry'

/**
 * Ente Auth 加密备份导入策略
 *
 * 加密方案（逆向自官方导出格式 v1）：
 *   1. 密钥派生: Argon2id (parallelism=1, hashLen=32)
 *      参数来自 JSON 的 kdfParams: { salt, opsLimit, memLimit }
 *   2. 对称解密: libsodium crypto_secretstream_xchacha20poly1305
 *      header = JSON 的 encryptionNonce (Base64)
 *      ciphertext = JSON 的 encryptedData (Base64)
 *   3. 明文格式: 换行分隔的 otpauth:// 链接
 *      Ente 私有参数 `codeDisplay=...`，导入时直接忽略
 */
export const enteStrategy = {
    /**
     * 探测一个已解析的 JSON 对象是否是 Ente Auth 加密导出
     * @param {Object} json
     * @returns {boolean}
     */
    isEnteEncrypted(json) {
        return (
            json &&
            typeof json.kdfParams === 'object' &&
            typeof json.encryptedData === 'string' &&
            typeof json.encryptionNonce === 'string'
        )
    },

    /**
     * 解密 Ente Auth 加密备份并解析为标准 VaultAccount 列表
     * @param {string} fileContent - 原始文件文本内容（JSON 字符串）
     * @param {string} password - 用户输入的导出密码
     * @returns {Promise<import('@/features/vault/service/vaultService').VaultAccount[]>}
     * @throws {Error} 密码错误时抛出 'INVALID_FORMAT_OR_PASSWORD'
     */
    async decryptAndParse(fileContent, password) {
        let data
        try {
            data = typeof fileContent === 'string' ? JSON.parse(fileContent) : fileContent
        } catch (e) {
            throw new Error('INVALID_FORMAT_OR_PASSWORD')
        }

        if (!this.isEnteEncrypted(data)) {
            throw new Error('INVALID_FORMAT_OR_PASSWORD')
        }

        if (!password) {
            throw new Error('PASSWORD_REQUIRED')
        }

        // === Step 1: Base64 解码各字段 ===
        const salt = _base64ToUint8Array(data.kdfParams.salt)
        const header = _base64ToUint8Array(data.encryptionNonce)
        const ciphertext = _base64ToUint8Array(data.encryptedData)

        const { opsLimit, memLimit } = data.kdfParams
        // hash-wasm argon2id 的 memorySize 单位是 KiB
        const memoryKiB = Math.floor(memLimit / 1024)

        // === Step 2: Argon2id 密钥派生 ===
        let key
        try {
            key = await argon2id({
                password,
                salt,
                parallelism: 1,
                iterations: opsLimit,
                memorySize: memoryKiB,
                hashLength: 32,
                outputType: 'binary',
            })
        } catch (e) {
            throw new Error('INVALID_FORMAT_OR_PASSWORD')
        }

        // === Step 3: 按需加载 libsodium-wrappers-sumo 并解密 ===
        let decryptedBytes
        try {
            const sodium = await _getSodium()
            const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key)
            const result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, ciphertext)
            if (!result || !result.message) throw new Error('no result')
            decryptedBytes = result.message
        } catch (e) {
            // 解密失败几乎肯定是密码错误
            throw new Error('INVALID_FORMAT_OR_PASSWORD')
        }

        // === Step 4: 解析明文 (换行分隔的 otpauth:// 链接) ===
        const plainText = new TextDecoder().decode(decryptedBytes)
        const lines = plainText.split('\n')
        const results = []

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('otpauth://')) continue
            const parsed = parseOtpUri(trimmed)
            if (parsed && parsed.secret) {
                results.push(parsed)
            }
        }

        return results
    }
}

// ─── 私有辅助函数 ───────────────────────────────────────────────────────────────

/**
 * 将 Base64 字符串解码为 Uint8Array（兼容标准 Base64 和 URL-safe Base64）
 * @param {string} base64
 * @returns {Uint8Array}
 */
function _base64ToUint8Array(base64) {
    // 补齐末尾 padding
    const padded = base64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
        Math.ceil(base64.length / 4) * 4, '='
    )
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

/** libsodium 单例，懒加载以避免非必要的 WASM 初始化开销 */
let _sodiumInstance = null

async function _getSodium() {
    if (_sodiumInstance) return _sodiumInstance
    const sodiumModule = await loadResource('libsodium')
    // 💡 架构师注：兼容拆包：如果 registry 返回的是 ESM 封装的 CJS，则从 default 中取
    const sodium = sodiumModule?.default || sodiumModule
    await sodium.ready
    _sodiumInstance = sodium
    return _sodiumInstance
}
