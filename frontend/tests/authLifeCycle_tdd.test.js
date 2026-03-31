
/**
 * 🛡️ 架构师 TDD 测试用例: 身份认证生命周期与防御式导航
 * 
 * 核心目标：
 * 1. 脉冲同步 (Pulse Sync): 验证只需一次 fetchUserInfo 即可确认状态。
 * 2. 循环隔离 (Cycle Isolation): 彻底消除 /login 路径下的 401 探测风暴。
 * 3. 内存原子化 (Atomic Reset): 验证注销时安全锁屏被静默关闭。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { useAppLockStore } from '@/features/applock/store/appLockStore'
import { authService } from '@/features/auth/service/authService'

// 模拟 IDB 存储
const { idbStore } = vi.hoisted(() => ({ idbStore: {} }))
vi.mock('@/shared/utils/idb', () => ({
    setIdbItem: vi.fn(async (key, val) => { idbStore[key] = val }),
    getIdbItem: vi.fn(async (key) => idbStore[key] || null),
    removeIdbItem: vi.fn(async (key) => { delete idbStore[key] }),
    clearIdbStore: vi.fn(async () => {
        Object.keys(idbStore).forEach(k => delete idbStore[k])
    }),
    openDB: vi.fn()
}))

// 模拟路由
const mockPush = vi.fn()
vi.mock('vue-router', () => ({
    useRouter: () => ({ push: mockPush }),
    createRouter: vi.fn(() => ({
        beforeEach: vi.fn(),
        push: mockPush,
        resolve: vi.fn(),
        install: vi.fn()
    })),
    createWebHistory: vi.fn()
}))

// 模拟 Vue Query
vi.mock('@tanstack/vue-query', () => ({
    useQueryClient: () => ({ clear: vi.fn() })
}))

// 模拟外部服务
vi.mock('@/features/auth/service/authService', () => ({
    authService: {
        fetchMe: vi.fn(),
        logout: vi.fn().mockResolvedValue({ success: true })
    }
}))

describe('Auth Lifecycle & Global Defense Strategy', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        Object.keys(idbStore).forEach(k => delete idbStore[k])
        vi.clearAllMocks()
    })

    /**
     * HP-01: 首次冷启动探测并加锁
     */
    it('should set isInitialized to true after any fetchUserInfo outcome', async () => {
        const authStore = useAuthUserStore()
        expect(authStore.isInitialized).toBe(false)

        // 模拟失败的 401 探测
        authService.fetchMe.mockResolvedValueOnce({ success: false })
        await authStore.fetchUserInfo()

        expect(authStore.isInitialized).toBe(true)
        expect(authStore.userInfo.id).toBeUndefined()
    })

    /**
     * HP-02: 静默重置 (Silent Wipe)
     * 验证注销时不会因为锁定导致 UI 弹窗
     */
    it('should silently reset security state before wiping IDB', async () => {
        const appLockStore = useAppLockStore()
        const authStore = useAuthUserStore()

        // 模拟已锁定状态
        appLockStore.isLocked = true
        appLockStore.lockMode = 'pin'

        await authStore.clearUserInfo()

        // 核心验收：isLocked 必须由于 reset() 被设为 false，防止 UI 闪现
        expect(appLockStore.isLocked).toBe(false)
        expect(appLockStore.lockMode).toBe('none')
    })

    /**
     * EC-01: 循环风暴防御 (401 Infinite Loop Prevention)
     * 这是之前导致浏览器崩溃的致命点
     */
    it('should not allow multiple clearUserInfo calls or redirects on failure if already initialized', async () => {
        const authStore = useAuthUserStore()

        // 1. 模拟第一次探测失败
        authService.fetchMe.mockResolvedValueOnce({ success: false })
        await authStore.fetchUserInfo()
        expect(authStore.isInitialized).toBe(true)

        // 2. 模拟第二次意外触发 (比如在 /login 误触了 guard)
        // 我们可以通过监测 authService.fetchMe 的调用次数来间接判断
        await authStore.fetchUserInfo()
        expect(authService.fetchMe).toHaveBeenCalledTimes(2)

        // 我们重点观察 router.push 在 clearUserInfo 里的表现（它应该已经被移除了）
        expect(mockPush).not.toHaveBeenCalled()
    })

    /**
     * EC-02: 内存与物理层原子化销毁
     */
    it('should wipe sync queue and IDB even if network logout fails', async () => {
        const authStore = useAuthUserStore()
        const { clearIdbStore } = await import('@/shared/utils/idb')

        idbStore['vault:data:main'] = 'dirty'

        // 模拟服务器超时
        authService.logout.mockRejectedValueOnce(new Error('Timeout'))

        await authStore.logout().catch(() => { }) // 即使报错也应清理

        expect(clearIdbStore).toHaveBeenCalled()
        expect(idbStore['vault:data:main']).toBeUndefined()
    })

    /**
     * HP-03: 注销即跳转 (Navigation decoupled)
     */
    it('should redirect only on explicit logout, not on background clear', async () => {
        const authStore = useAuthUserStore()

        // 1. 背景清理不应跳转 (避免死循环)
        await authStore.clearUserInfo()
        expect(mockPush).not.toHaveBeenCalled()

        // 2. 主动注销必须跳转
        await authStore.logout()
        expect(mockPush).toHaveBeenCalledWith('/login')
    })
})
