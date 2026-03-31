import * as scrypt from 'scrypt-js'
import { hexToBytes, base64ToBytes } from '@/shared/utils/encoding'

/**
 * Aegis 备份数据库解密策略 (Decoding Strategy)
 */
export const aegisStrategy = {
    /**
     * @param {Object} jsonObj - 解析后的 Aegis JSON 结构
     * @param {string} password - 用户的解密密码
     * @returns {Promise<Object>} 解密后的数据库明文 (JSON 对象)
     */
    async decryptDatabase(jsonObj, password) {
        const slots = jsonObj.header.slots
        if (!slots || !slots.length) throw new Error("Aegis: 找不到密钥槽")
        const dbBase64 = jsonObj.db
        const dbParams = jsonObj.header.params

        let masterKey = null
        const passwordBytes = new TextEncoder().encode(password)

        for (const slot of slots) {
            if (slot.type === 1) {
                const saltBytes = hexToBytes(slot.salt)
                const derivedKey = await scrypt.scrypt(passwordBytes, saltBytes, slot.n, slot.r, slot.p, 32)

                const encryptedKey = hexToBytes(slot.key)
                const nonce = hexToBytes(slot.key_params.nonce)
                const tag = hexToBytes(slot.key_params.tag)

                const cipherText = new Uint8Array(encryptedKey.length + tag.length)
                cipherText.set(encryptedKey)
                cipherText.set(tag, encryptedKey.length)

                try {
                    const cryptoKey = await window.crypto.subtle.importKey(
                        'raw', derivedKey, { name: 'AES-GCM' }, false, ['decrypt']
                    )
                    const decryptedMaster = await window.crypto.subtle.decrypt(
                        { name: 'AES-GCM', iv: nonce }, cryptoKey, cipherText
                    )
                    masterKey = new Uint8Array(decryptedMaster)
                    break
                } catch (e) {
                    continue // Try next slot
                }
            }
        }

        if (!masterKey) throw new Error("Aegis: 密码错误或不支持的加密格式 (缺少 Scrypt)")

        const dbBytes = base64ToBytes(dbBase64)
        const dbNonce = hexToBytes(dbParams.nonce)
        const dbTag = hexToBytes(dbParams.tag)

        const dbCipherText = new Uint8Array(dbBytes.length + dbTag.length)
        dbCipherText.set(dbBytes)
        dbCipherText.set(dbTag, dbBytes.length)

        const dbCryptoKey = await window.crypto.subtle.importKey(
            'raw', masterKey, { name: 'AES-GCM' }, false, ['decrypt']
        )
        try {
            const plainDbBuffer = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: dbNonce }, dbCryptoKey, dbCipherText
            )
            return JSON.parse(new TextDecoder().decode(plainDbBuffer))
        } catch (e) {
            throw new Error("Aegis: 数据库载荷解密失败")
        }
    }
}
