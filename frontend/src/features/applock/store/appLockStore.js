import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getIdbItem, setIdbItem, removeIdbItem } from '@/shared/utils/idb'
import { appLockService } from '@/features/applock/service/appLockService'
import { ElMessage } from 'element-plus'
import { i18n } from '@/locales'

/**
 * 🔐 Security Store
 */
export const useAppLockStore = defineStore('appLock', () => {
    const isInitialized = ref(false)
    const isLocked = ref(false)
    const lockMode = ref('none') // 'none' | 'pin' | 'biometric' | 'biometric_compat'
    const failedAttempts = ref(0)
    const lastFailedTime = ref(0)
    const isBiometricAvailable = ref(false)
    const autoLockDelay = ref(0)
    const lastHiddenTime = ref(0)
    const isUnlocking = ref(false)

    // 🧬 认证上下文：提前从 IDB 加载到内存
    const bioAuthContext = ref(null)

    // 内存中的解密密钥，仅生命周期存续
    const memorySalt = ref(null)

    /**
     * 🧬 预热生物识别上下文
     */
    const preWarmBiometricContext = async () => {
        if (!['biometric', 'biometric_compat'].includes(lockMode.value)) return
        try {
            const encData = await getIdbItem('sys:sec:bio_enc_salt')
            const credId = await getIdbItem('sys:sec:bio_cred_id')
            if (encData && credId) {
                bioAuthContext.value = { encData, credId }
            }
        } catch (e) {
            console.error('[AppLockStore] Pre-warm failed:', e)
        }
    }

    /**
     * 初始化安全状态
     */
    const init = async () => {
        isBiometricAvailable.value = appLockService.isBiometricSupported() || appLockService.isLegacyBiometricSupported()

        const mode = await getIdbItem('sys:sec:lock_mode') || 'none'
        lockMode.value = mode

        const hasEncSalt = !!(await getIdbItem('sys:sec:enc_device_salt'))
        if (mode !== 'none' && hasEncSalt) {
            isLocked.value = true
            // 锁定状态下立即异步预热，不阻塞 init 完成
            preWarmBiometricContext()
        }

        autoLockDelay.value = await getIdbItem('sys:sec:auto_lock_delay') || 0

        document.addEventListener('visibilitychange', () => {
            if (lockMode.value === 'none') return
            if (document.visibilityState === 'hidden') {
                const now = Date.now()
                lastHiddenTime.value = now
                localStorage.setItem('app_lock_last_hidden', now.toString())
                if (Number(autoLockDelay.value) === 0) lock()
            } else if (document.visibilityState === 'visible') {
                const storedTime = localStorage.getItem('app_lock_last_hidden')
                const hiddenAt = lastHiddenTime.value || Number(storedTime || 0)
                if (Number(autoLockDelay.value) > 0 && hiddenAt > 0 && !isLocked.value) {
                    const elapsed = (Date.now() - hiddenAt) / 1000
                    if (elapsed > Number(autoLockDelay.value)) lock()
                }
                lastHiddenTime.value = 0
                localStorage.removeItem('app_lock_last_hidden')
            }
        })

        isInitialized.value = true
    }

    const setDeviceKey = async (rawSalt) => {
        const mode = await getIdbItem('sys:sec:lock_mode')
        if (mode && mode !== 'none') {
            isLocked.value = true
            preWarmBiometricContext()
            return
        }
        await setIdbItem('sys:sec:device_salt', rawSalt)
        memorySalt.value = rawSalt
        lockMode.value = 'none'
        isLocked.value = false
    }

    const getDeviceKey = async () => {
        if (memorySalt.value) return memorySalt.value
        if (!isLocked.value && lockMode.value === 'none') {
            const raw = await getIdbItem('sys:sec:device_salt')
            if (raw) memorySalt.value = raw
            return raw
        }
        return null
    }

    const setupPin = async (pin) => {
        if (!pin || pin.length !== 6) throw new Error('PIN must be 6 digits')
        let rawSalt = memorySalt.value || await getIdbItem('sys:sec:device_salt')
        if (!rawSalt) throw new Error('System salt not found')

        const salt = appLockService.generateSalt()
        const masterKey = await appLockService.deriveKeyFromPin(pin, salt)
        const encrypted = await appLockService.encryptDeviceSalt(rawSalt, masterKey)

        await setIdbItem('sys:sec:enc_device_salt', { ...encrypted, salt })
        await setIdbItem('sys:sec:lock_mode', 'pin')
        lockMode.value = 'pin'
        isLocked.value = false
        await removeIdbItem('sys:sec:device_salt')
    }

    const unlockWithPin = async (pin) => {
        if (failedAttempts.value >= 3) {
            const now = Date.now()
            const waitTime = failedAttempts.value >= 5 ? 300000 : 30000
            if (now - lastFailedTime.value < waitTime) {
                const remaining = Math.ceil((waitTime - (now - lastFailedTime.value)) / 1000)
                throw new Error(`Too many attempts. Wait ${remaining}s`)
            }
        }

        const encData = await getIdbItem('sys:sec:enc_device_salt')
        if (!encData) return false

        const masterKey = await appLockService.deriveKeyFromPin(pin, encData.salt)
        const rawSeed = await appLockService.decryptDeviceSalt(encData.encrypted, encData.iv, masterKey)

        if (rawSeed) {
            memorySalt.value = rawSeed
            isLocked.value = false
            failedAttempts.value = 0
            return true
        } else {
            failedAttempts.value++
            lastFailedTime.value = Date.now()
            return false
        }
    }

    const enableBiometric = async (userData = {}) => {
        const isPRF = appLockService.isBiometricSupported()
        const isLegacy = appLockService.isLegacyBiometricSupported()
        if (!isPRF && !isLegacy) throw new Error('Biometric not supported')

        const rawSalt = await getIdbItem('sys:sec:device_salt') || memorySalt.value
        if (!rawSalt) throw new Error('Unlocked state required')

        if (isPRF) {
            const bioResult = await appLockService.enrollBiometric(userData)
            if (!bioResult) return false
            const bioMasterKey = await crypto.subtle.importKey('raw', bioResult.key, { name: 'AES-GCM' }, false, ['encrypt'])
            const encrypted = await appLockService.encryptDeviceSalt(rawSalt, bioMasterKey)
            await setIdbItem('sys:sec:bio_enc_salt', encrypted)
            await setIdbItem('sys:sec:bio_cred_id', bioResult.credId)
            await updateLockMode('biometric')
            preWarmBiometricContext()
            return true
        } else {
            const credId = await appLockService.enrollBiometricCompatible(userData)
            if (!credId) return false
            const wrapKeyRaw = crypto.getRandomValues(new Uint8Array(32))
            const bioMasterKey = await crypto.subtle.importKey('raw', wrapKeyRaw, { name: 'AES-GCM' }, false, ['encrypt'])
            const encrypted = await appLockService.encryptDeviceSalt(rawSalt, bioMasterKey)
            await setIdbItem('sys:sec:bio_wrap_key', wrapKeyRaw)
            await setIdbItem('sys:sec:bio_enc_salt', encrypted)
            await setIdbItem('sys:sec:bio_cred_id', credId)
            await updateLockMode('biometric_compat')
            preWarmBiometricContext()
            return true
        }
    }

    /**
     * 🧬 生物识别快捷解锁 (核心入口)
     */
    const unlockWithBiometric = async (isManual = false) => {
        if (isUnlocking.value && !isManual) return false
        const forceReset = isManual

        if (!bioAuthContext.value) {
            await preWarmBiometricContext()
        }

        if (!bioAuthContext.value) return false

        isUnlocking.value = true
        const { encData, credId } = bioAuthContext.value

        try {
            let bioKeyRaw = null

            if (lockMode.value === 'biometric') {
                bioKeyRaw = await appLockService.getBiometricKey(credId, forceReset)
            } else if (lockMode.value === 'biometric_compat') {
                const verified = await appLockService.verifyBiometricCompatible(credId, forceReset)
                if (verified) {
                    bioKeyRaw = await getIdbItem('sys:sec:bio_wrap_key')
                }
            }

            if (bioKeyRaw) {
                const bioMasterKey = await crypto.subtle.importKey('raw', bioKeyRaw, { name: 'AES-GCM' }, false, ['decrypt'])
                const rawSeed = await appLockService.decryptDeviceSalt(encData.encrypted, encData.iv, bioMasterKey)
                if (rawSeed) {
                    memorySalt.value = rawSeed
                    isLocked.value = false
                    failedAttempts.value = 0
                    return true
                }
            }
            return false
        } catch (e) {
            throw e
        } finally {
            isUnlocking.value = false
        }
    }

    const disableLock = async (pin) => {
        const encData = await getIdbItem('sys:sec:enc_device_salt')
        if (!encData) return false
        const masterKey = await appLockService.deriveKeyFromPin(pin, encData.salt)
        const rawSeed = await appLockService.decryptDeviceSalt(encData.encrypted, encData.iv, masterKey)
        if (!rawSeed) return false

        await setIdbItem('sys:sec:device_salt', rawSeed)
        memorySalt.value = rawSeed
        await removeIdbItem('sys:sec:enc_device_salt')
        await removeIdbItem('sys:sec:bio_enc_salt')
        await removeIdbItem('sys:sec:bio_cred_id')
        await updateLockMode('none')
        isLocked.value = false
        return true
    }

    const lock = () => {
        memorySalt.value = null
        isLocked.value = true
        preWarmBiometricContext()
    }

    const updateLockMode = async (mode) => {
        await setIdbItem('sys:sec:lock_mode', mode)
        lockMode.value = mode
    }

    const setAutoLockDelay = async (seconds) => {
        autoLockDelay.value = seconds
        await setIdbItem('sys:sec:auto_lock_delay', seconds)
        // 延迟调用翻译，防止静态引用导致的循环依赖或初始化异常
        const message = i18n.global.t('security.auto_lock_delay_updated')
        ElMessage.success({
            message,
            grouping: true
        })
    }

    const reset = () => {
        isLocked.value = false
        lockMode.value = 'none'
        memorySalt.value = null
        failedAttempts.value = 0
        bioAuthContext.value = null
    }

    return {
        isInitialized,
        isLocked,
        lockMode,
        autoLockDelay,
        failedAttempts,
        isBiometricAvailable,
        isUnlocking,
        init,
        setDeviceKey,
        getDeviceKey,
        setupPin,
        unlockWithPin,
        enableBiometric,
        unlockWithBiometric,
        disableLock,
        updateLockMode,
        setAutoLockDelay,
        lock,
        reset
    }
})
