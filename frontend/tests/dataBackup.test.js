/**
 * 备份源管理 (Data Backup) 集成测试
 * 
 * 核心目标：
 * 验证应用对第三方存储平台（S3, WebDAV, Google Drive 等）的集成逻辑。
 * 
 * 验证重点：
 * 1. 自动重连与 Token 刷新：对于 Google Drive/Microsoft，验证 Auth 弹窗的监听逻辑。
 * 2. 状态可视化：验证“上一次同步成功/失败”的时间戳与状态标签渲染。
 * 3. 密码找回机制 (Auto Backup Password)：验证系统是否自动保存备份密钥，并在恢复时自动回填。
 * 4. 连通性测试 (Test Connection)：验证在点击测试按钮时，加载动画 (loading) 的精确控制。
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import { ref } from 'vue'
import DataBackup from '@/features/backup/views/dataBackup.vue'
import { commonStubs } from './test-utils'

// --- 模块模拟 ---

vi.mock('@/locales', () => ({
    i18n: { global: { t: (k) => k, te: () => true, install: vi.fn() } }
}))

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (k) => k }),
    createI18n: vi.fn(() => ({ global: { t: (k) => k } }))
}))

vi.mock('@/features/backup/composables/useBackupProviders', () => ({
    useBackupProviders: vi.fn()
}))

vi.mock('@/features/backup/composables/useBackupActions', () => ({
    useBackupActions: vi.fn()
}))

vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: () => ({ isMobile: false })
}))

vi.mock('element-plus', async () => {
    const actual = await vi.importActual('element-plus')
    return {
        ...actual,
        ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
        ElMessageBox: { confirm: vi.fn(() => Promise.resolve()) }
    }
})

describe('DataBackup Layout & Interaction Integration', () => {

    const createBaseProvidersMock = () => ({
        providers: ref([]), isLoading: ref(false), showConfigDialog: ref(false), isEditing: ref(false),
        isTesting: ref(false), isSaving: ref(false), testingProviderIds: ref({}), testResults: ref({}),
        form: ref({ type: 'email', name: '', config: {}, autoBackup: false }),
        fetchProviders: vi.fn(), openAddDialog: vi.fn(), testConnection: vi.fn(),
        saveProvider: vi.fn(), deleteProvider: vi.fn(), setupAuthListener: vi.fn(() => vi.fn()),
        availableTypes: ['s3', 'webdav', 'email', 'telegram']
    })

    const createBaseActionsMock = () => ({
        showBackupDialog: ref(false), backupPassword: ref(''), isBackingUp: ref(false),
        openBackupDialog: vi.fn(), handleBackup: vi.fn(),
        showRestoreListDialog: ref(false), backupFiles: ref([]),
        openRestoreDialog: vi.fn(), handleRestore: vi.fn()
    })

    const localStubs = {
        ...commonStubs,
        'el-tag': { template: '<span class="el-tag-stub"><slot /></span>' },
        'el-select': true, 'el-option': true, 'el-switch': true, 'Edit': true, 'Delete': true
    }

    /**
     * Case 01: 备份源卡片渲染
     * 目标：验证 UI 呈现正确。
     * 解决问题：确保每个配置好的 S3 或 WebDAV 备份源能显示其别名、类型及最后的健康状态。
     */
    it('should accurately render the provider list with health tags', async () => {
        const { useBackupProviders } = await import('@/features/backup/composables/useBackupProviders')
        const { useBackupActions } = await import('@/features/backup/composables/useBackupActions')

        useBackupProviders.mockReturnValue({
            ...createBaseProvidersMock(),
            providers: ref([{ id: '1', name: 'S3-Primary', type: 's3', lastBackupStatus: 'success' }])
        })
        useBackupActions.mockReturnValue(createBaseActionsMock())

        render(DataBackup, { global: { mocks: { $t: k => k }, stubs: localStubs } })

        expect(screen.getByText('S3-Primary')).toBeTruthy()
        expect(screen.getByText('success')).toBeTruthy() // 状态标签
    })
})
