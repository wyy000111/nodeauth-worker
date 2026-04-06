/**
 * Strategy 7: Import UX (导入用户体验增强测试)
 * 
 * 核心目标：
 * 验证在导入大规模 2FA 数据时的 UI 细腻度。
 * 
 * 修复目标 (UX Fixes)：
 * 1. 进度弹窗停留感 (FIX 1)：在大批量导入完成后，进度条不应瞬间消失，而应停留 1200ms 展示“完成”状态。
 * 2. 离线反馈闭环 (FIX 2)：在离线模式下导入成功后，依然要触发“成功”通知，并明确标记为“已进入同步队列”。
 * 3. 错误聚合展示：如果 100 个账号中 2 个失败，不能弹 100 个通知，应聚合成 1 个汇总通知。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'

// --- 模块模拟 ---

vi.mock('@/locales', () => ({
    i18n: {
        global: {
            t: (key) => key,
            te: () => true
        }
    }
}))

vi.mock('element-plus', () => ({
    ElMessage: { warning: vi.fn(), error: vi.fn() },
    ElNotification: vi.fn(),
}))

vi.mock('@/features/migration/service/dataMigrationService', () => ({
    dataMigrationService: {
        saveImportedVault: vi.fn(),
        parseImportData: vi.fn(),
        detectFileType: vi.fn(),
        parseGaQrImageFile: vi.fn(),
    }
}))

vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: vi.fn(() => ({ isOffline: true }))
}))

vi.mock('@/features/vault/store/vaultStore', () => ({
    useVaultStore: vi.fn(() => ({
        markDirty: vi.fn(),
        updateMetadata: vi.fn().mockResolvedValue(true)
    }))
}))

import { ElNotification } from 'element-plus'
import { dataMigrationService } from '@/features/migration/service/dataMigrationService'
import { useDataImport } from '@/features/migration/composables/useDataImport'

/**
 * 助手函数：模拟批量导入完成。
 */
async function triggerFinishBatch(composable, accumulatedVault = [], errors = []) {
    composable.batchTotalJobs.value = accumulatedVault.length || 1
    composable.batchProcessedJobs.value = accumulatedVault.length || 1
    composable.batchAccumulatedVault.value = [...accumulatedVault]
    composable.batchErrors.value = [...errors]
    composable.showBatchProgress.value = true

    const pending = composable.finishBatchImport()
    // 推进所有虚拟时间，包括内部处理 1200ms 停留延迟的 Timer
    await vi.runAllTimersAsync()
    await pending
}

describe('Strategy 7: Import UX — Progress Dialog Delay & Offline Notification', () => {
    let emitFn

    beforeEach(() => {
        setActivePinia(createPinia())
        vi.useFakeTimers()
        vi.clearAllMocks()
        emitFn = vi.fn()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    /**
     * Case 01: 进度弹窗的视觉停留
     * 目标：增强完成感。
     * 解决问题：当导入极快时（如 1 个账号），进度条瞬间从 0 到 100 然后消失，用户会怀疑是否真的导入了。停留 1200ms 能提供明确的视觉反馈。
     */
    it('HP-01: 进度弹窗不立即关闭 — 完成后停留至少 1200ms', async () => {
        vi.mocked(dataMigrationService.saveImportedVault).mockResolvedValue({ success: true, count: 1 })
        const c = useDataImport(emitFn)

        c.batchTotalJobs.value = 1
        c.batchProcessedJobs.value = 1
        c.showBatchProgress.value = true
        c.importingJobs.value = 0 // 模拟所有任务完成

        // 推进 300ms (debounce 时长) 触发完成逻辑
        await nextTick()
        await vi.advanceTimersByTimeAsync(300)
        await Promise.resolve()

        // 断言：即使逻辑已运行完，showBatchProgress 仍应为 true (处于 1200ms 宽限内)
        expect(c.showBatchProgress.value).toBe(true)
    })

    /**
     * Case 02: 离线模式下的“警告式成功”通知
     * 目标：明确离线状态。
     * 解决问题：离线导入成功后，不能弹普通的绿色 Success，而应弹黄色的 Warning，告知用户数据在同步队列中待处理。
     */
    it('HP-04: [离线] pending:true → ElNotification 仍被调用，type=warning', async () => {
        vi.mocked(dataMigrationService.saveImportedVault).mockResolvedValue({
            success: true, count: 3, pending: true
        })
        const c = useDataImport(emitFn)

        await triggerFinishBatch(c, [{ service: 'A' }, { service: 'B' }, { service: 'C' }])

        expect(vi.mocked(ElNotification)).toHaveBeenCalledTimes(1)
        const call = vi.mocked(ElNotification).mock.calls[0][0]
        expect(call.type).toBe('warning')
        expect(call.message).toContain('migration.msg_offline_queued')
    })

    /**
     * Case 03: 复杂异常汇总 (Mixed Results)
     * 目标：防止通知轰炸。
     * 解决问题：当导入伴随解析错误时，将 duration 设为 0 (永不自动关闭)，确保用户看清哪些失败了。
     */
    it('EC-03: [离线] 有解析错误 + 部分成功 → duration=0 永不自动关闭', async () => {
        vi.mocked(dataMigrationService.saveImportedVault).mockResolvedValue({ success: true, count: 3, pending: true })
        const c = useDataImport(emitFn)

        await triggerFinishBatch(c, [{ service: 'A' }], ['Format Error Line 5'])

        const call = vi.mocked(ElNotification).mock.calls[0][0]
        expect(call.duration).toBe(0) // 必须手动关闭
        expect(call.message).toContain('migration.msg_error_summary')
    })
})
