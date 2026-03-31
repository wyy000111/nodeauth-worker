/**
 * 🔒 Security Service
 * Implements high-intensity cryptographic logic for local security locks.
 * Using Web Crypto API (SubtleCrypto)
 */

import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser'

const PIN_PBKDF2_ITERATIONS = 100000
const SALT_LENGTH = 16
const IV_LENGTH = 12

export const appLockService = {
    isBiometricSupported() {
        if (!browserSupportsWebAuthn()) return false
        // 🛡️ 方案 A 探针：检查 PRF 扩展
        const caps = window.PublicKeyCredential?.getClientExtensionCapabilities?.() || {}
        return !!caps.prf
    },

    /**
     * 🕵️ 方案 B 探针：检查是否至少支持基础 WebAuthn 平台认证器
     */
    isLegacyBiometricSupported() {
        return browserSupportsWebAuthn()
    },

    /**
     * 🆕 步骤1-B：降级注册生物识别 (Scenario B)
     */
    async enrollBiometricCompatible(userData = {}) {
        const rpId = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname
        const options = {
            challenge: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
            rp: { name: 'NodeAuth', id: rpId },
            user: {
                id: 'nodeauth-compat',
                name: userData.email || userData.username || 'nodeauth',
                displayName: `NodeAuth Lock (${userData.email || userData.username || 'Account'})`
            },
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
            authenticatorSelection: {
                authenticatorAttachment: 'platform',
                userVerification: 'required'
            }
        }
        try {
            const attestation = await startRegistration(options)
            return attestation.id
        } catch (e) {
            console.error('[SecurityService] Compact enrollment failed:', e)
            return null
        }
    },

    /**
     * 🆕 步骤2-B：降级验证生物识别 (Scenario B)
     */
    async verifyBiometricCompatible(credId) {
        if (!credId) return false
        const options = {
            challenge: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
            allowCredentials: [{ id: credId, type: 'public-key' }],
            userVerification: 'required'
        }
        try {
            const assertion = await startAuthentication(options)
            return !!assertion
        } catch (e) {
            console.error('[SecurityService] Compact auth failed:', e)
            return false
        }
    },



    /**
     * 🆕 步骤1：注册生物识别凭证 (Enrollment)
     * 必须先在硬件中注册一个带有 PRF 能力的本设备凭证
     */
    async enrollBiometric(userData = {}) {
        const rpId = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname
        const options = {
            challenge: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
            rp: { name: 'NodeAuth', id: rpId },
            user: {
                id: 'nodeauth-lock',
                name: userData.email || userData.username || 'nodeauth',
                displayName: `NodeAuth Lock (${userData.email || userData.username || 'Account'})`
            },
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
            authenticatorSelection: {
                userVerification: 'required',
                residentKey: 'required',
                requireResidentKey: true
            },
            extensions: {
                // 🛡️ macOS 15+ / Chrome / Yubikey 标准启用语法
                prf: { enabled: true }
            }

        }

        try {
            const attestation = await startRegistration(options)

            // 🛡️ 核心：验证硬件是否真正透传并激活了 PRF
            if (!attestation.clientExtensionResults?.prf) {
                // 如果 Passkey 成功了但 PRF 没成功，说明是硬件不支持 HMAC Secret 派生
                throw new Error('E_PRF_NOT_SUPPORTED')
            }

            // 🔄 注册成功后，立即尝试第一次定向派生
            const firstKey = await this.getBiometricKey(attestation.id)
            if (!firstKey) throw new Error('E_DERIVATION_FAILED')

            return { key: firstKey, credId: attestation.id }
        } catch (e) {
            console.error('[SecurityService] Enrollment trap:', e)
            throw e
        }
    },


    /**
     * 🆕 步骤2：获取生物识别密钥 (Authentication)
     */
    async getBiometricKey(credId) {
        const dummyB64 = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE'
        const options = {
            challenge: dummyB64,
            allowCredentials: credId ? [{ id: credId, type: 'public-key' }] : [],
            userVerification: 'required',
            extensions: {
                prf: { eval: { first: dummyB64 } } // 使用 B64URL 格式避免 replace 报错
            }
        }

        try {
            const assertion = await startAuthentication(options)
            const prfResults = assertion.clientExtensionResults?.prf
            if (prfResults?.results?.first) {
                return new Uint8Array(prfResults.results.first)
            }
            throw new Error('PRF key not returned by hardware')
        } catch (e) {
            console.error('[SecurityService] Auth failed:', e)
            return null
        }
    },

    /**
     * 1. 密钥派生 (PIN -> Key)
     * 将 6 位 PIN 转换为对称加密密钥
     */
    async deriveKeyFromPin(pin, salt) {
        if (pin.length !== 6) throw new Error('PIN must be 6 digits')

        const enc = new TextEncoder()
        const passwordKey = await crypto.subtle.importKey(
            'raw',
            enc.encode(pin),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        )

        return await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: PIN_PBKDF2_ITERATIONS,
                hash: 'SHA-256'
            },
            passwordKey,
            { name: 'AES-GCM', length: 256 },
            false, // 不可导出，增强安全
            ['encrypt', 'decrypt']
        )
    },

    /**
     * 2. 加密逻辑 (Encryption)
     * 使用派生密钥加密原 device_salt
     */
    async encryptDeviceSalt(rawSalt, masterKey) {
        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
        const enc = new TextEncoder()
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            masterKey,
            enc.encode(rawSalt)
        )
        return {
            encrypted: new Uint8Array(encrypted),
            iv,
            salt: null // 外部传入盐值不在此持久化
        }
    },

    /**
     * 3. 解密逻辑 (Decryption)
     * 使用 PIN 验证并尝试还原 device_salt
     */
    async decryptDeviceSalt(encryptedData, iv, masterKey) {
        try {
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                masterKey,
                encryptedData
            )
            const dec = new TextDecoder()
            return dec.decode(decrypted)
        } catch (e) {
            return null // 解密失败 (PIN 错误)
        }
    },

    /**
     * 🎲 随机盐值生成
     */
    generateSalt() {
        return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
    }
}
