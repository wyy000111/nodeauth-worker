import { ref, onMounted, onUnmounted, watch } from 'vue'
import { base32ToBytes, bytesToBase32, hexToBytes, bytesToHex, asciiToBytes, bytesToAscii, base64ToBytes, bytesToBase64, generateTOTP, parseOtpUri, getAccurateTime, buildOtpUri } from '@/shared/utils/totp'

/**
 * 提取 TOTP 工具箱的状态机与计算逻辑
 */
export function useTotpToolbox() {
    const app_active_tab = ref('base32')
    const secretBase32 = ref('')
    const secretHex = ref('')
    const secretAscii = ref('')
    const secretBase64 = ref('')

    // Metadata & Settings
    const issuer = ref('NodeAuth.io')
    const account = ref('NodeAuth')
    const algorithm = ref('SHA-1')
    const digits = ref(6)
    const period = ref(30)
    const app_time_offset = ref(0)

    const currentUri = ref('')
    const currentCode = ref('')
    const remaining = ref(30)
    let timer = null

    // 监听算法变化，针对 Steam 令牌进行自动联动
    watch(algorithm, (newAlgo) => {
        if (newAlgo === 'STEAM') {
            digits.value = 5
            period.value = 30
            // 选择 STEAM 算法时，由于其唯一性，直接强制对齐参数与发行方
            issuer.value = 'Steam'
        } else if (digits.value === 5) {
            digits.value = 6
            // 切回普通算法时，恢复默认品牌名
            issuer.value = 'NodeAuth.io'
        }
        updateAll('settings')
    })

    // --- 同步输入联动 ---
    const updateAll = async (sourceType) => {
        try {
            // 1. 同步各类输入制式
            if (sourceType === 'base32') {
                const bytes = base32ToBytes(secretBase32.value)
                secretHex.value = bytesToHex(bytes)
                secretAscii.value = bytesToAscii(bytes)
                secretBase64.value = bytesToBase64(bytes)
            } else if (sourceType === 'hex') {
                const bytes = hexToBytes(secretHex.value)
                if (bytes.length > 0) {
                    secretBase32.value = bytesToBase32(bytes)
                    secretAscii.value = bytesToAscii(bytes)
                    secretBase64.value = bytesToBase64(bytes)
                }
            } else if (sourceType === 'ascii') {
                const bytes = asciiToBytes(secretAscii.value)
                secretBase32.value = bytesToBase32(bytes)
                secretHex.value = bytesToHex(bytes)
                secretBase64.value = bytesToBase64(bytes)
            } else if (sourceType === 'base64') {
                const bytes = base64ToBytes(secretBase64.value)
                if (bytes.length > 0) {
                    secretBase32.value = bytesToBase32(bytes)
                    secretHex.value = bytesToHex(bytes)
                    secretAscii.value = bytesToAscii(bytes)
                }
            }

            // 2. URI 字符串生成 (统一逻辑)
            if (secretBase32.value) {
                currentUri.value = buildOtpUri({
                    service: issuer.value,
                    account: account.value,
                    secret: secretBase32.value,
                    algorithm: algorithm.value,
                    digits: digits.value,
                    period: period.value
                })
            } else {
                currentUri.value = ''
                currentCode.value = ''
            }

            // 3. 立即重算一次 TOTP
            calcTotp()
        } catch (e) {
            console.error(e)
        }
    }

    const handleBase32Input = () => updateAll('base32')
    const handleHexInput = () => updateAll('hex')
    const handleAsciiInput = () => updateAll('ascii')
    const handleBase64Input = () => updateAll('base64')
    const updateUri = () => updateAll('settings')

    // --- 随机生成 ---
    const refreshBase32 = () => {
        const array = new Uint8Array(20)
        window.crypto.getRandomValues(array)
        secretBase32.value = bytesToBase32(array)
        updateAll('base32')
    }

    const refreshHex = () => {
        const array = new Uint8Array(20)
        window.crypto.getRandomValues(array)
        secretHex.value = bytesToHex(array)
        updateAll('hex')
    }

    const refreshAscii = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()'
        let result = ''
        const array = new Uint32Array(20)
        window.crypto.getRandomValues(array)
        for (let i = 0; i < 20; i++) result += chars[array[i] % chars.length]
        secretAscii.value = result
        updateAll('ascii')
    }

    const refreshBase64 = () => {
        const array = new Uint8Array(20)
        window.crypto.getRandomValues(array)
        secretBase64.value = bytesToBase64(array)
        updateAll('base64')
    }

    // --- TOTP 主力计算核心 ---
    const calcTotp = async () => {
        if (!secretBase32.value) return

        const p = period.value
        const now = (getAccurateTime() / 1000) + app_time_offset.value
        remaining.value = Math.ceil(p - (now % p))

        try {
            const periodOffset = Math.floor(app_time_offset.value / p)
            currentCode.value = await generateTOTP(secretBase32.value, p, digits.value, algorithm.value, periodOffset)
        } catch (e) {
            currentCode.value = 'ERROR'
        }
    }

    // --- 时间调节器 (Time Travel) ---
    const adjustTime = (delta, reset = false) => {
        if (reset) app_time_offset.value = 0
        else app_time_offset.value += delta
        calcTotp()
    }

    // --- 扫码解析注入 ---
    const handleParsedUri = (uri) => {
        const parsed = parseOtpUri(uri)
        if (parsed) {
            if (parsed.secret) {
                secretBase32.value = parsed.secret
                updateAll('base32')
            }
            if (parsed.service) issuer.value = parsed.service
            if (parsed.account) account.value = parsed.account
            if (parsed.digits) digits.value = parsed.digits
            if (parsed.period) period.value = parsed.period
            if (parsed.algorithm) algorithm.value = parsed.algorithm

            updateAll('settings')
            return true
        }
        return false
    }

    onMounted(() => {
        refreshBase32()
        timer = setInterval(calcTotp, 1000)
    })

    onUnmounted(() => { if (timer) clearInterval(timer) })

    return {
        app_active_tab,
        secretBase32, secretHex, secretAscii, secretBase64,
        issuer, account, algorithm, digits, period, app_time_offset,
        currentUri, currentCode, remaining,
        handleBase32Input, handleHexInput, handleAsciiInput, handleBase64Input, updateUri,
        refreshBase32, refreshHex, refreshAscii, refreshBase64,
        adjustTime, handleParsedUri
    }
}
