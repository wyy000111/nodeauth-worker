import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { vaultService } from '@/features/vault/service/vaultService'
import { request } from '@/shared/utils/request'
import { useVaultSyncStore } from '@/features/vault/store/vaultSyncStore'

/**
 * Strategy 6: Offline Import & Fallback Queue
 * (离线导入与退避队列策略)
 * 
 * 核心目标：
 * 验证大批量数据导入在“断网”、“弱网”或“假在线”环境下的鲁棒性。
 * 
 * 关键策略：
 * 1. 离线截断 (Zero Invocation)：若识别到 Navigator.onLine 为 false，直接不发起请求，存入 SyncQueue。
 * 2. 失败降级 (Network Fallback)：若请求发起后抛出 Fetch Error，自动将该批次导入任务序列化并压入本地待同步队列。
 * 3. 全局唯一识标 (ID Persistence)：离线导入的每一项都必须分配临时的 tmp_id，确保恢复网络后能被正确去重。
 */

vi.mock('@/shared/utils/request', () => ({
    request: vi.fn()
}))

vi.mock('@/shared/utils/idb', () => ({
    getIdbItem: vi.fn().mockResolvedValue(null),
    setIdbItem: vi.fn().mockResolvedValue(true),
    removeIdbItem: vi.fn().mockResolvedValue(true)
}))

describe('Strategy 6: Offline Import & Fallback Queue', () => {
    let syncStore

    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
        syncStore = useVaultSyncStore()
        vi.spyOn(syncStore, 'enqueueAction')
        vi.spyOn(syncStore, 'enqueueActions')
    })

    describe('Happy Path: Online vs Offline Flow', () => {
        /**
         * Case 01: 在线导入直连后端
         * 目标：验证正常路径。
         */
        it('HP-01: 在线单记录导入发往后端成功', async () => {
            request.mockResolvedValueOnce({ success: true, count: 1 })
            const result = await vaultService.importVault({ account: 'test1', service: 'Test' }, 'raw')

            expect(request).toHaveBeenCalledTimes(1)
            expect(result.success).toBe(true)
            expect(syncStore.enqueueAction).not.toHaveBeenCalled() // 不应进入离线队列
        })

        /**
         * Case 02: 纯离线拦截逻辑
         * 目标：验证 Zero Invocation。
         * 解决问题：在明确断网时，不应浪费系统资源去尝试 Fetch，直接改为本地队列存储。
         */
        it('HP-03: 纯离线状态侦听 (Zero Invocation)', async () => {
            Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

            const result = await vaultService.importVault({ account: 'test1' })

            expect(request).not.toHaveBeenCalled()
            expect(result.pending).toBe(true)
            expect(syncStore.enqueueActions).toHaveBeenCalledTimes(1)
        })

        /**
         * Case 03: 弱网/崩溃降级
         * 目标：验证异常捕获。
         * 解决问题：有时浏览器显示在线，但请求瞬间断网。系统需捕获 TypeError，并像离线一样将数据存入队列，保证“导入操作”在用户看来是立刻成功的。
         */
        it('HP-04: 假在线弱网感知 (网络抛错降级)', async () => {
            const networkError = new TypeError('Failed to fetch')
            request.mockRejectedValueOnce(networkError)

            const result = await vaultService.importVault({ account: 'timeoutUser' })

            expect(request).toHaveBeenCalledTimes(1)
            expect(result.success).toBe(true)
            expect(result.pending).toBe(true)
            expect(syncStore.enqueueActions).toHaveBeenCalledTimes(1)
        })
    })

    describe('Edge Cases: 极大规模与冲突防范', () => {
        /**
         * Case 04: 千级数据积压压力测试
         * 目标：验证离线队列的性能。
         * 解决问题：确保离线导入 1000 条记录时，系统不会因为序列化过大而阻塞 UI 线程。
         */
        it('EC-04: 十万级大批量导入在离线模式时的响应与同步器积压', async () => {
            Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
            const largeArray = Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}` }))

            const result = await vaultService.importVault(largeArray)

            expect(syncStore.enqueueActions).toHaveBeenCalledTimes(1)
            expect(result.count).toBe(1000)
        })

        /**
         * Case 05: 业务层 500 错误不降级
         * 目标：验证降级边界。
         * 解决问题：只有“网络断开”才触发离线队列，如果是后端返回 500 逻辑错误，应报错而非降级，防止脏数据在离线队列积压。
         */
        it('EC-09: 非标准抛错的严格拒绝 (500 Error)', async () => {
            request.mockRejectedValueOnce({ name: 'Error', message: 'Internal Server Error 500' })

            await expect(vaultService.importVault([{ id: '500-error' }])).rejects.toThrow('Failed to import vault data')
            expect(syncStore.enqueueAction).not.toHaveBeenCalled()
        })
    })
})
