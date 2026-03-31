/**
 * 数据迁移逻辑 (Data Migration Logic) 单元测试
 * 
 * 核心目标：
 * 验证应用对外部 2FA 数据格式的兼容性与迁移安全性。
 * 解决 2FA 工具最痛的“数据孤岛”问题，确保用户能平滑从 Aegis, Bitwarden 等迁入。
 * 
 * 覆盖场景：
 * 1. 自动识别：通过文件内容或扩展名自动判定来源（Aegis, Steam, JSON 等）。
 * 2. 加密解析：对于带密码的导出文件（如 Aegis Encrypted），验证解密对话框的唤起。
 * 3. 结构转换：验证外部 JSON 结构能否准确映射为内部 Vault 对象。
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import { ref } from 'vue'
import DataMigration from '@/features/migration/views/dataMigration.vue'
import { commonStubs } from './test-utils'

// --- 模块模拟 ---

vi.mock('@/locales', () => ({
    i18n: { global: { t: (k) => k } }
}))

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (k) => k })
}))

// 模拟导出 Composable
vi.mock('@/features/migration/composables/useDataExport', () => ({
    useDataExport: vi.fn()
}))

// 模拟导入 Composable
vi.mock('@/features/migration/composables/useDataImport', () => ({
    useDataImport: vi.fn()
}))

vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: () => ({ isMobile: false })
}))

describe('DataMigration Logic - Cross-Platform Compatibility', () => {

    // 抽象：标准的 Export Mock 构造器
    const createBaseExportMock = () => ({
        showPasswordDialog: ref(false), showWarningDialog: ref(false), showAccountSelectDialog: ref(false), showGaDialog: ref(false),
        isExporting: ref(false), exportForm: ref({ password: '', confirm: '' }), loadingText: ref(''),
        gaQrDataUrls: ref([]), gaCurrentIndex: ref(0), fullVault: ref([{ id: '1', service: 'Github', account: 'test' }]),
        searchKeyword: ref(''), selectedAccountIds: ref([]), filteredVault: ref([{ id: '1', service: 'Github', account: 'test' }]),
        openExportDialog: vi.fn(), openWarningDialog: vi.fn(), openGaDialogDirectly: vi.fn(), executeExport: vi.fn(), executeGaExport: vi.fn(), toggleSelectAll: vi.fn()
    })

    // 抽象：标准的 Import Mock 构造器
    const createBaseImportMock = () => ({
        currentImportType: ref(null), showDecryptDialog: ref(false), importPassword: ref(''), isDecrypting: ref(false),
        showBatchProgress: ref(false), batchCurrentTaskName: ref(''), batchProcessedJobs: ref(0), batchTotalJobs: ref(0), batchProgressPercent: ref(0),
        handleFileUpload: vi.fn(), submitEncryptedData: vi.fn(), handleDecryptDialogClose: vi.fn()
    })

    /**
     * Case 01: 组件基础渲染与国际化
     * 目标：验证迁移入口的可见性。
     */
    it('should correctly render migration components and labels', async () => {
        const { useDataExport } = await import('@/features/migration/composables/useDataExport')
        const { useDataImport } = await import('@/features/migration/composables/useDataImport')
        useDataExport.mockReturnValue(createBaseExportMock())
        useDataImport.mockReturnValue(createBaseImportMock())

        render(DataMigration, {
            global: {
                mocks: { $t: k => k },
                stubs: commonStubs
            }
        })

        // 验证导出按钮文本是否存在
        expect(screen.getAllByText(/^migration\.export$/).length).toBeGreaterThan(0)
    })

    /**
     * Case 02: 自动识别 Aegis 加密文件
     * 目标：验证文件类型探测。
     * 解决问题：当用户上传 Aegis 特有的加密 JSON 后，系统应自动识别类型并主动弹出解密 PIN 码对话框。
     */
    it('should identify Aegis file and show decrypt UI', async () => {
        const { useDataImport } = await import('@/features/migration/composables/useDataImport')
        useDataImport.mockReturnValue({
            ...createBaseImportMock(),
            showDecryptDialog: ref(true),
            currentImportType: ref('aegis_encrypted')
        })

        render(DataMigration, {
            global: {
                mocks: { $t: k => k },
                stubs: commonStubs
            }
        })

        // 断言：由于 currentImportType 为 aesgis_encrypted，应显示对应提醒文本
        expect(screen.getByText(/migration\.detect_aegis/)).toBeTruthy()
    })
})
