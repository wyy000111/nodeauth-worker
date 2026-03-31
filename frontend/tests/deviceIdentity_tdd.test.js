import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sessionService } from '@/features/auth/service/sessionService'

// 模拟 localStorage
const localStorageMock = (() => {
    let store = {}
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = value.toString() },
        clear: () => { store = {} },
        removeItem: (key) => { delete store[key] }
    }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// 模拟 API 调用
vi.mock('@/shared/utils/request', () => ({
    request: vi.fn()
}))

describe('Frontend TDD: Device Identity Management', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('HP-01: [DeviceID 初始化] should generate and persist a UUID if one does not exist', async () => {
        // 假设我们有一个获取 DeviceID 的 utility
        const { getDeviceId } = await import('@/shared/utils/device')

        const id1 = getDeviceId()
        expect(id1).toMatch(/^[0-9a-f-]{36}$/)
        expect(localStorage.getItem('app_device_id')).toBe(id1)

        const id2 = getDeviceId()
        expect(id1).toBe(id2) // 验证持久性
    })

    it('HP-02: [全局展示] should fetch devices list without session-only filter (Global View)', async () => {
        const { request } = await import('@/shared/utils/request')
        request.mockResolvedValue({
            success: true,
            sessions: [
                { id: '1', userId: 'a@b.com', isCurrent: true },
                { id: '2', userId: 'other@test.com', isCurrent: false }
            ]
        })

        const res = await sessionService.getSessions()
        expect(res.sessions).toHaveLength(2)
        // 验证逻辑层正确透传了后端返回的全局列表
        expect(res.sessions.some(s => s.userId === 'other@test.com')).toBe(true)
    })

    it('HP-03: [注销所有] should call backend to sign out all system devices', async () => {
        const { request } = await import('@/shared/utils/request')
        request.mockResolvedValue({ success: true })

        await sessionService.deleteAllOtherSessions()

        // 验证调用了正确的全局注销接口
        expect(request).toHaveBeenCalledWith('/api/oauth/sessions', expect.objectContaining({ method: 'DELETE' }))
    })
})
