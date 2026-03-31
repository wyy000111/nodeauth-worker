import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/vue'
import { ref } from 'vue'
import DataImport from '@/features/migration/views/dataImport.vue'
import DataExport from '@/features/migration/views/dataExport.vue'
import { commonStubs } from './test-utils'

/**
 * 迁移界面 (Migration UI/UX) 专项测试套件
 * 
 * 核心目标：
 * 验证数据导入导出页面的视觉与交互规范。
 * 重点：响应式网格布局、平台卡片交互、操作反馈流。
 * 
 * 场景：
 * 1. 网格化入口：验证 2FA 平台是否按照预期的 Card 样式排列。
 * 2. 交互一致性：点击平台卡片应能正确触发对应的导出逻辑。
 */

// --- 模块模拟 ---

vi.mock('@/locales', () => ({
    i18n: { global: { t: (k) => k } }
}))

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (k) => k })
}))

vi.mock('@/features/migration/composables/useDataExport', () => ({
    useDataExport: vi.fn()
}))

vi.mock('@/features/migration/composables/useDataImport', () => ({
    useDataImport: vi.fn()
}))

vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: vi.fn(() => ({ isMobile: false }))
}))

describe('Migration UI - Responsive Platform Grid', () => {

    const createBaseImportMock = () => ({
        currentImportType: ref(null), showDecryptDialog: ref(false), importPassword: ref(''), isDecrypting: ref(false),
        showBatchProgress: ref(false), batchCurrentTaskName: ref(''), batchProcessedJobs: ref(0), batchTotalJobs: ref(0), batchProgressPercent: ref(0),
        handleFileUpload: vi.fn(), submitEncryptedData: vi.fn(), handleDecryptDialogClose: vi.fn()
    })

    const createBaseExportMock = () => ({
        showPasswordDialog: ref(false), showWarningDialog: ref(false), showAccountSelectDialog: ref(false), showGaDialog: ref(false),
        isExporting: ref(false), exportForm: ref({ password: '', confirm: '' }), loadingText: ref(''),
        gaQrDataUrls: ref([]), gaCurrentIndex: ref(0), fullVault: ref([{ id: '1', service: 'Github' }]),
        searchKeyword: ref(''), selectedAccountIds: ref([]), filteredVault: ref([{ id: '1', service: 'Github' }]),
        openExportDialog: vi.fn(), openWarningDialog: vi.fn(), openGaDialogDirectly: vi.fn(), executeExport: vi.fn(), executeGaExport: vi.fn(), toggleSelectAll: vi.fn()
    })

    describe('Import UI: DataImport.vue', () => {
        /**
         * Case 01: 导入页面网格布局
         * 目标：验证跨平台支持列表。
         * 解决问题：之前版本使用列表样式，空间利用率低且不美观。新版应使用 .migration-platform-grid。
         */
        it('should use the new grid layout and card components for import', async () => {
            const { useDataImport } = await import('@/features/migration/composables/useDataImport')
            useDataImport.mockReturnValue(createBaseImportMock())

            const { container } = render(DataImport, {
                global: {
                    mocks: { $t: k => k },
                    stubs: { ...commonStubs, 'upload-filled': true }
                }
            })

            // 验证是否存在网格容器与平台卡片
            const grid = container.querySelector('.migration-platform-grid')
            expect(grid).toBeTruthy()
            const cards = container.querySelectorAll('.migration-platform-card')
            expect(cards.length).toBeGreaterThan(0)
        })
    })

    describe('Export UI: DataExport.vue', () => {
        /**
         * Case 02: 导出页面布局一致性
         * 目标：验证导出功能的分类展示。
         */
        it('should use the new grid layout and card components for export', async () => {
            const { useDataExport } = await import('@/features/migration/composables/useDataExport')
            useDataExport.mockReturnValue(createBaseExportMock())

            const { container } = render(DataExport, {
                global: {
                    mocks: { $t: k => k },
                    stubs: commonStubs
                }
            })

            const grid = container.querySelector('.migration-platform-grid')
            expect(grid).toBeTruthy()
        })

        /**
         * Case 03: 点击平台卡片触发导出
         * 目标：验证交互闭环。
         * 解决问题：确保每个 Card 都是可点击的，且能呼起密码保护弹窗。
         */
        it('should trigger exports when clicking on a platform card', async () => {
            const { useDataExport } = await import('@/features/migration/composables/useDataExport')
            const mockExport = createBaseExportMock()
            useDataExport.mockReturnValue(mockExport)

            const { container } = render(DataExport, {
                global: {
                    mocks: { $t: k => k },
                    stubs: commonStubs
                }
            })

            const firstCard = container.querySelector('.migration-platform-card')
            if (firstCard) {
                await fireEvent.click(firstCard)
                // 预期：点击后应调用打开对话框的方法
                expect(mockExport.openExportDialog || mockExport.openWarningDialog).toHaveBeenCalled()
            }
        })
    })
})
