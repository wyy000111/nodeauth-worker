import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getIdbItem, setIdbItem, removeIdbItem } from '@/shared/utils/idb'
import { appLockService } from '../service/appLockService'
import { ElMessage } from 'element-plus'
import { i18n } from '@/locales'

/**
 * 🔐 Security Store (核心锁控)
 */
export const useAppLockStore = defineStore('appLock', () => {
    const isInitialized = ref(false)
    const isLocked = ref(false)
    const lockMode = ref('none') // 'none' | 'pin' | 'biometric'
    const failedAttempts = ref(0)
    const lastFailedTime = ref(0)
    const isBiometricAvailable = ref(false)
    const autoLockDelay = ref(0) // 👈 自动锁定延迟 (秒)
    const lastHiddenTime = ref(0) // 👈 上次切到后台的时间


    // 内存中的解密密钥，仅生命周期存续
    const memorySalt = ref(null)

    /**
     * 初始化安全状态 (检测 IDB 持久化)
     */
    const init = async () => {
        isBiometricAvailable.value = appLockService.isBiometricSupported() || appLockService.isLegacyBiometricSupported()


        const mode = await getIdbItem('sys:sec:lock_mode') || 'none'
        lockMode.value = mode

        const hasEncSalt = !!(await getIdbItem('sys:sec:enc_device_salt'))
        if (mode !== 'none' && hasEncSalt) {
            isLocked.value = true
        }

        autoLockDelay.value = await getIdbItem('sys:sec:auto_lock_delay') || 0

        // 🛡️ 侦听应用切换逻辑 (优化版)
        document.addEventListener('visibilitychange', () => {
            if (lockMode.value === 'none') return

            if (document.visibilityState === 'hidden') {
                const now = Date.now()
                lastHiddenTime.value = now
                localStorage.setItem('app_lock_last_hidden', now.toString())

                // 如果是立即锁定(0s)，则直接执行
                if (Number(autoLockDelay.value) === 0) {
                    lock()
                }
            } else if (document.visibilityState === 'visible') {
                const storedTime = localStorage.getItem('app_lock_last_hidden')
                const hiddenAt = lastHiddenTime.value || Number(storedTime || 0)

                // 如果不是立即锁定，则在切回时计算时间差
                if (Number(autoLockDelay.value) > 0 && hiddenAt > 0 && !isLocked.value) {
                    const elapsed = (Date.now() - hiddenAt) / 1000
                    if (elapsed > Number(autoLockDelay.value)) {
                        console.log(`[AppLock] Auto-lock triggered after ${Math.round(elapsed)}s`)
                        lock()
                    }
                }
                // 重置探测点
                lastHiddenTime.value = 0
                localStorage.removeItem('app_lock_last_hidden')
            }
        })

        isInitialized.value = true
    }



    /**
     * 🚪 登录时注入主密钥
     */
    const setDeviceKey = async (rawSalt) => {
        // 1. 如果当前已经开启了安全锁，则注入到内存，等待解密 (由于已加密，此处注入不应直接写回明文 IDB)
        const mode = await getIdbItem('sys:sec:lock_mode')
        if (mode && mode !== 'none') {
            // 目前处于加密模式，新登录下需要先用 PIN 码解密已有的 Blob
            isLocked.value = true
            return
        }

        // 2. 无锁模式，直接存入 IDB
        await setIdbItem('sys:sec:device_salt', rawSalt)
        memorySalt.value = rawSalt
        lockMode.value = 'none'
        isLocked.value = false
    }

    /**
     * 获取设备密钥 (device_salt)
     */
    const getDeviceKey = async () => {
        // 1. 如果还在内存中，直接返回
        if (memorySalt.value) return memorySalt.value

        // 2. 如果未锁定，尝试从 IDB 读取明文 (旧版本/未开启锁)
        if (!isLocked.value && lockMode.value === 'none') {
            const raw = await getIdbItem('sys:sec:device_salt')
            if (raw) memorySalt.value = raw
            return raw
        }

        // 3. 被锁定，必须先通过 UI 解锁
        return null
    }

    /**
     * 设置 6 位 PIN 码锁
     */

    const setupPin = async (pin) => {
        if (!pin || pin.length !== 6) throw new Error('PIN must be 6 digits')

        // 🛡️ 优先从内存获取（已登录/已解锁状态）
        let rawSalt = memorySalt.value

        // 🛡️ 其次从 IDB 获取明文（初次设置）
        if (!rawSalt) {
            rawSalt = await getIdbItem('sys:sec:device_salt')
        }

        if (!rawSalt) throw new Error('System salt not found, login first')

        // 2. 派生加密 Key
        const salt = appLockService.generateSalt()
        const masterKey = await appLockService.deriveKeyFromPin(pin, salt)

        // 3. 执行加密
        const encrypted = await appLockService.encryptDeviceSalt(rawSalt, masterKey)

        // 4. 持久化加密形态
        await setIdbItem('sys:sec:enc_device_salt', { ...encrypted, salt })
        await setIdbItem('sys:sec:lock_mode', 'pin')
        lockMode.value = 'pin'
        isLocked.value = false

        // 5. 🛡️ 物理销毁明文
        await removeIdbItem('sys:sec:device_salt')
    }


    /**
     * 使用 PIN 码解锁 (带防暴力破解校验)
     */
    const unlockWithPin = async (pin) => {
        // 🛡️ 暴力破解校验
        if (failedAttempts.value >= 3) {
            const now = Date.now()
            const waitTime = failedAttempts.value >= 5 ? 300000 : 30000; // 5次5分钟，3次30秒
            if (now - lastFailedTime.value < waitTime) {
                const remaining = Math.ceil((waitTime - (now - lastFailedTime.value)) / 1000)
                throw new Error(`Too many attempts. Please try again in ${remaining}s`)
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
            lastFailedTime.value = 0
            return true
        } else {
            failedAttempts.value++
            lastFailedTime.value = Date.now()
            return false
        }
    }


    /**
     * 🟢 开启生物识别 (FaceID/Fingerprint)
     * 支持 Scenario A (PRF) 和 Scenario B (兼容模式)
     */
    const enableBiometric = async (userData = {}) => {
        const isPRF = appLockService.isBiometricSupported()
        const isLegacy = appLockService.isLegacyBiometricSupported()

        if (!isPRF && !isLegacy) throw new Error('Biometric not supported')

        const rawSalt = await getIdbItem('sys:sec:device_salt') || memorySalt.value
        if (!rawSalt) throw new Error('System unlocked state required')

        if (isPRF) {
            // 🛡️ 方案 A：硬件级密钥派生 (PRF)
            const bioResult = await appLockService.enrollBiometric(userData)
            if (!bioResult) return false // 👈 用户取消

            const bioMasterKey = await crypto.subtle.importKey(
                'raw', bioResult.key, { name: 'AES-GCM' }, false, ['encrypt']
            )
            const encrypted = await appLockService.encryptDeviceSalt(rawSalt, bioMasterKey)

            await setIdbItem('sys:sec:bio_enc_salt', encrypted)
            await setIdbItem('sys:sec:bio_cred_id', bioResult.credId)
            await setIdbItem('sys:sec:lock_mode', 'biometric')
            lockMode.value = 'biometric'
            return true // 👈 开启成功
        } else {
            // 🧬 方案 B：降级兼容模式 (Software Wrap)
            const credId = await appLockService.enrollBiometricCompatible(userData)
            if (!credId) return false // 👈 用户取消

            // 1. 生成本地包装密钥 (Wrap Key)
            const wrapKeyRaw = crypto.getRandomValues(new Uint8Array(32))

            // 2. 加密主数据
            const bioMasterKey = await crypto.subtle.importKey(
                'raw', wrapKeyRaw, { name: 'AES-GCM' }, false, ['encrypt']
            )
            const encrypted = await appLockService.encryptDeviceSalt(rawSalt, bioMasterKey)

            // 3. 存储全套字段
            await setIdbItem('sys:sec:bio_wrap_key', wrapKeyRaw)
            await setIdbItem('sys:sec:bio_enc_salt', encrypted)
            await setIdbItem('sys:sec:bio_cred_id', credId)
            await setIdbItem('sys:sec:lock_mode', 'biometric_compat')
            lockMode.value = 'biometric_compat'
            return true // 👈 开启成功
        }
    }

    /**
     * 🧬 生物识别快解
     */
    const unlockWithBiometric = async () => {
        const encData = await getIdbItem('sys:sec:bio_enc_salt')
        const credId = await getIdbItem('sys:sec:bio_cred_id')
        if (!encData || !credId) return false

        let bioKeyRaw = null

        if (lockMode.value === 'biometric') {
            // 方案 A：从硬件派生
            bioKeyRaw = await appLockService.getBiometricKey(credId)
        } else if (lockMode.value === 'biometric_compat') {
            // 方案 B：本地提取并口令验证
            const verified = await appLockService.verifyBiometricCompatible(credId)
            if (verified) {
                bioKeyRaw = await getIdbItem('sys:sec:bio_wrap_key')
            }
        }

        if (!bioKeyRaw) return false

        const bioMasterKey = await crypto.subtle.importKey(
            'raw', bioKeyRaw, { name: 'AES-GCM' }, false, ['decrypt']
        )

        const rawSeed = await appLockService.decryptDeviceSalt(encData.encrypted, encData.iv, bioMasterKey)

        if (rawSeed) {
            memorySalt.value = rawSeed
            isLocked.value = false
            failedAttempts.value = 0 // 重置尝试次数
            return true
        }
        return false
    }



    /**
     * 🛡️ 停用安全锁
     * 将系统退回到明文模式 (需 PIN 验证授权)
     */
    const disableLock = async (pin) => {
        // 1. 验证身份并获取明文
        const encData = await getIdbItem('sys:sec:enc_device_salt')
        if (!encData) return false

        const masterKey = await appLockService.deriveKeyFromPin(pin, encData.salt)
        const rawSeed = await appLockService.decryptDeviceSalt(encData.encrypted, encData.iv, masterKey)
        if (!rawSeed) return false

        // 2. 还原明文 Device Salt 到物理存储
        await setIdbItem('sys:sec:device_salt', rawSeed)
        memorySalt.value = rawSeed

        // 3. 彻底物理清理所有加密痕迹
        await removeIdbItem('sys:sec:enc_device_salt')
        await removeIdbItem('sys:sec:bio_enc_salt')
        await removeIdbItem('sys:sec:bio_cred_id')
        await setIdbItem('sys:sec:lock_mode', 'none')

        lockMode.value = 'none'
        isLocked.value = false
        return true
    }

    /**
     * 锁定系统
     */
    const lock = () => {
        memorySalt.value = null
        isLocked.value = true
    }

    /**
     * 🛡️ 架构师抛光：统一更新锁定模式并持久化
     */
    const updateLockMode = async (mode) => {
        await setIdbItem('sys:sec:lock_mode', mode)
        lockMode.value = mode
    }

    /**
     * 更新自动锁定延迟
     */
    const setAutoLockDelay = async (seconds) => {
        autoLockDelay.value = seconds
        await setIdbItem('sys:sec:auto_lock_delay', seconds)
        ElMessage.success({
            message: i18n.global.t('security.auto_lock_delay_updated'),
            grouping: true
        })
    }

    /**
     * 🛡️ 架构师修复: 彻底重置安全状态 (用于登出流)
     * 静默清空所有内存状态，不触发 UI 锁定
     */
    const reset = () => {
        isLocked.value = false
        lockMode.value = 'none'
        memorySalt.value = null
        failedAttempts.value = 0
    }

    return {
        isInitialized,
        isLocked,
        lockMode,
        autoLockDelay,
        failedAttempts,
        isBiometricAvailable,
        init,

        setDeviceKey,
        getDeviceKey,
        setupPin,
        unlockWithPin,
        enableBiometric,
        unlockWithBiometric,
        disableLock,
        updateLockMode,
        setAutoLockDelay, // 👈 导出新方法
        lock,
        reset
    }
})





