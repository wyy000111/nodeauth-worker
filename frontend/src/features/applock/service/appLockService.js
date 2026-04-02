/**
 * 🔒 Security Service
 * Implements high-intensity cryptographic logic for local security locks.
 * Using Web Crypto API (SubtleCrypto)
 */

import {
    startAuthentication,
    startRegistration,
    browserSupportsWebAuthn,
    WebAuthnAbortService
} from '@simplewebauthn/browser'

const PIN_PBKDF2_ITERATIONS = 100000
const SALT_LENGTH = 16
const IV_LENGTH = 12
const RP_ID = window.location.hostname

export const appLockService = {
    /**
     * 🛡️ 检查浏览器/硬件是否支持 PRF 扩展
     */
    isBiometricSupported() {
        if (!browserSupportsWebAuthn()) return false
        const caps = window.PublicKeyCredential?.getClientExtensionCapabilities?.() || {}
        return !!caps.prf
    },

    /**
     * 🕵️ 检查是否支持基础平台认证器
     */
    isLegacyBiometricSupported() {
        return browserSupportsWebAuthn()
    },

    /**
     * 【架构改进】安全取消当前正在进行的 WebAuthn 仪式
     */
    cancelCurrentCeremony() {
        try {
            WebAuthnAbortService.cancelCeremony()
        } catch (e) {
            // 忽略正常的中止异常
        }
    },

    /**
     * 🆕 步骤1-B：降级注册生物识别 (Scenario B)
     */
    async enrollBiometricCompatible(userData = {}) {
        const options = {
            challenge: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
            rp: { name: 'NodeAuth', id: RP_ID },
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
            console.error('[AppLockService] Compat enrollment failed:', e)
            throw e
        }
    },

    /**
     * 🆕 步骤2-B：降级验证生物识别 (Scenario B)
     * @param {string} credId 凭证ID
     * @param {boolean} forceReset 是否强制重置旧会话
     */
    async verifyBiometricCompatible(credId, forceReset = false) {
        if (!credId) throw new Error('MISSING_CRED_ID')

        if (forceReset) {
            this.cancelCurrentCeremony()
        }

        const options = {
            challenge: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
            allowCredentials: [{ id: credId, type: 'public-key' }],
            userVerification: 'required',
            rpId: RP_ID
        }

        try {
            const assertion = await startAuthentication(options)
            return !!assertion
        } catch (e) {
            if (e?.name !== 'AbortError') {
                console.error('[AppLockService] Compat auth failed:', e.name)
            }
            throw e
        }
    },

    /**
     * 🆕 步骤1：注册生物识别凭证 (Enrollment - Scenario A)
     */
    async enrollBiometric(userData = {}) {
        const options = {
            challenge: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
            rp: { name: 'NodeAuth', id: RP_ID },
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
                prf: { enabled: true }
            }
        }

        try {
            const attestation = await startRegistration(options)
            if (!attestation.clientExtensionResults?.prf) {
                throw new Error('E_PRF_NOT_SUPPORTED')
            }
            const firstKey = await this.getBiometricKey(attestation.id)
            if (!firstKey) throw new Error('E_DERIVATION_FAILED')
            return { key: firstKey, credId: attestation.id }
        } catch (e) {
            console.error('[AppLockService] Enrollment failed:', e)
            throw e
        }
    },


    /**
     * 🆕 步骤2：获取生物识别密钥 (Authentication - Scenario A)
     * @param {string} credId 凭证ID
     * @param {boolean} forceReset 是否强制重置旧会话
     */
    async getBiometricKey(credId, forceReset = false) {
        if (forceReset) {
            this.cancelCurrentCeremony()
        }

        const dummyB64 = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE'
        const options = {
            challenge: dummyB64,
            allowCredentials: credId ? [{ id: credId, type: 'public-key' }] : [],
            userVerification: 'required',
            rpId: RP_ID,
            extensions: {
                prf: { eval: { first: dummyB64 } }
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
            if (e?.name !== 'AbortError') {
                console.error('[AppLockService] Auth failed:', e.name)
            }
            throw e
        }
    },

    /**
     * 1. 密钥派生 (PIN -> Key)
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
            false,
            ['encrypt', 'decrypt']
        )
    },

    /**
     * 2. 加密逻辑 (Encryption)
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
            salt: null
        }
    },

    /**
     * 3. 解密逻辑 (Decryption)
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
            return null
        }
    },

    /**
     * 🎲 随机盐值生成
     */
    generateSalt() {
        return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
    }
}
