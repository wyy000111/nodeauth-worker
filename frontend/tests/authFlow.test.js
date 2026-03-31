/**
 * 身份认证链路 (Security Architecture: AuthFlow) 集成测试
 * 
 * 核心目标：
 * 验证 PWA 环境下的“端到端安全闭环”。
 * 这不是简单的登录接口测试，而是验证登录态与 IndexedDB 加密存储之间的联动：
 * 1. 设备盐值 (Device Salt) 安全：如果没有 Salt，即使有本地密文也无法解密。
 * 2. 自动解锁：登录成功后，系统应自动利用下发的 Key 解密本地缓存的金库。
 * 3. 彻底清空 (Zero Trace)：退出登录时，必须物理删除 IDB 中的敏感密钥和数据。
 * 4. 容错防御：如果密文被篡改，系统应优雅报错并保护数据一致性。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { useVaultStore } from '@/features/vault/store/vaultStore'

// 1. 模拟 IndexedDB：精准控制持久化存储的行为
const { idbStore } = vi.hoisted(() => ({ idbStore: {} }))
vi.mock('@/shared/utils/idb', () => ({
    setIdbItem: vi.fn(async (key, val) => { idbStore[key] = val }),
    getIdbItem: vi.fn(async (key) => {
        const val = idbStore[key]
        return val !== undefined ? val : null
    }),
    removeIdbItem: vi.fn(async (key) => { delete idbStore[key] }),
    clearIdbStore: vi.fn(async () => {
        Object.keys(idbStore).forEach(k => delete idbStore[k])
    })
}))

vi.mock('@tanstack/vue-query', () => ({
    useQueryClient: vi.fn(() => ({
        clear: vi.fn(),
        setQueryData: vi.fn(),
        getQueryData: vi.fn()
    }))
}))

vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn() })
}))

// 2. 模拟加密逻辑：确保加密协议与 Pinia Store 完美对齐
vi.mock('@/shared/utils/crypto', () => ({
    encryptDataWithPassword: vi.fn(async (data, key) => {
        return `ENC:${key}:${JSON.stringify(data)}`
    }),
    decryptDataWithPassword: vi.fn(async (enc, key) => {
        if (!enc.startsWith('ENC:')) throw new Error('Bad Format')
        const parts = enc.split(':')
        const storedKey = parts[1]
        const jsonData = parts.slice(2).join(':')
        if (storedKey !== key) {
            throw new Error(`Key Mismatch: expected ${storedKey}, got ${key}`)
        }
        return JSON.parse(jsonData)
    })
}))

vi.mock('@/features/auth/service/authService', () => ({
    authService: {
        logout: vi.fn().mockResolvedValue({ success: true }),
        fetchMe: vi.fn()
    }
}))

describe('Auth Flow Integration - The Security Pipeline', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        // 核心：彻底清空模拟存储以防测试干扰
        Object.keys(idbStore).forEach(k => delete idbStore[k])
        vi.clearAllMocks()
    })

    /**
     * Case 01: 未授权访问拦截 (Default Lock)
     * 目标：验证冷启动安全性。
     * 解决问题：防止黑客绕过登录 UI 直接通过 Console 调用 vaultStore，当 IDB 中缺少 Device Salt 时，解密动作必须失败。
     */
    it('should stay locked if device key is missing', async () => {
        const vaultStore = useVaultStore()
        await expect(vaultStore.getData()).rejects.toThrow('设备授权信息已失效')
    })

    /**
     * Case 02: 登录后的“冷解密”自动化流
     * 目标：验证登录态与金库存储的绑定。
     * 解决问题：模拟用户输入密码登录后，后端回传密钥。系统需自动将该密钥存入 IDB，并唤醒金库解密流程，实现“登录即解锁”。
     */
    it('should unlock and decrypt correctly after login simulation', async () => {
        const vaultStore = useVaultStore()
        const deviceKey = 'server-generated-session-key'
        const mockVaultData = { vault: [{ id: '99', service: 'TestPass' }] }

        // 1. 模拟已有加密数据在本地存储中
        idbStore['vault:data:main'] = `ENC:${deviceKey}:${JSON.stringify(mockVaultData)}`

        // 2. 模拟登录成功，秘钥写入 IDB (模仿 Login.vue 的后续动作)
        const { setIdbItem } = await import('@/shared/utils/idb')
        await setIdbItem('sys:sec:device_salt', deviceKey)

        // 3. 断言：金库现在能够正确解密数据
        const data = await vaultStore.getData()
        expect(data.vault).toHaveLength(1)
        const appLockStore = (await import('@/features/applock/store/appLockStore')).useAppLockStore()
        expect(appLockStore.isLocked).toBe(false)
    })

    /**
     * Case 03: 强制隐私抹除 (Safety Logout)
     * 目标：验证退出登录后的数据无痕。
     * 解决问题：当用户点下 Logout 后，不仅内存要清空，IndexedDB 中的设备盐、用户资料、加密账户列表也必须全部销毁，确保护理人员或下个设备用户不可见。
     */
    it('should wipe all trace of session on logout', async () => {
        const authStore = useAuthUserStore()
        idbStore['sys:sec:device_salt'] = 'key'
        idbStore['auth:user:profile'] = { name: 'hsiao' }
        idbStore['vault:data:main'] = 'blob'

        await authStore.logout()

        // 验证：所有敏感 Key 均被删除
        expect(idbStore['sys:sec:device_salt']).toBeUndefined()
        expect(idbStore['auth:user:profile']).toBeUndefined()
        expect(idbStore['vault:data:main']).toBeUndefined()
    })

    /**
     * Case 04: 数据篡改后的韧性校验
     * 目标：防止脏数据污染。
     * 解决问题：如果在离线存储过程中数据被篡改，系统应在解密环节捕获异常并返回空列表，而不是抛出未捕获异常导致白屏。
     */
    it('should survive data tampering by returning empty vault safely', async () => {
        const vaultStore = useVaultStore()
        idbStore['sys:sec:device_salt'] = 'legal-key'
        idbStore['vault:data:main'] = 'ENC:hacked-key:{"stolen":true}'

        const result = await vaultStore.getData()
        expect(result.vault).toEqual([]) // 安全回退为空
    })
})
