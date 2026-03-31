import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { dataMigrationService } from '@/features/migration/service/dataMigrationService'
import { downloadBlob } from '@/shared/utils/common'
import { i18n } from '@/locales'

export function useDataExport() {
    const { t } = i18n.global
    const showPasswordDialog = ref(false)
    const showWarningDialog = ref(false)
    const showGaDialog = ref(false)
    const isExporting = ref(false)
    const exportForm = ref({ password: '', confirm: '' })
    const loadingText = ref('')

    const currentType = ref('')
    const currentVariant = ref('generic')

    // GA 分批导出相关
    const gaQrDataUrls = ref([])
    const gaCurrentIndex = ref(0)

    // GA 按需导出选择器相关
    const showAccountSelectDialog = ref(false)
    const fullVault = ref([])
    const searchKeyword = ref('')
    const selectedAccountIds = ref([])

    const openExportDialog = (type, variant = 'generic') => {
        currentType.value = type
        currentVariant.value = variant
        exportForm.value = { password: '', confirm: '' }
        showPasswordDialog.value = true
    }

    const openWarningDialog = (type, variant = 'generic') => {
        currentType.value = type
        currentVariant.value = variant
        showWarningDialog.value = true
    }

    // 计算属性：过滤后的账号列表
    const filteredVault = computed(() => {
        const keyword = searchKeyword.value.toLowerCase().trim()
        if (!keyword) return fullVault.value
        return fullVault.value.filter(acc =>
            (acc.service && acc.service.toLowerCase().includes(keyword)) ||
            (acc.account && acc.account.toLowerCase().includes(keyword))
        )
    })

    // 直接开启 Google Auth 导出流程（跳过明文警告弹窗）
    const openGaDialogDirectly = () => {
        currentType.value = 'gauth'
        executeExport()
    }

    // 全选/取消全选 (仅作用于当前过滤结果)
    const toggleSelectAll = (val) => {
        const filteredIds = filteredVault.value.map(acc => acc.id)
        if (val) {
            // 将不在已选列表中的过滤结果加入已选列表
            const newIds = filteredIds.filter(id => !selectedAccountIds.value.includes(id))
            selectedAccountIds.value.push(...newIds)
        } else {
            // 将过滤结果从已选列表中移除
            selectedAccountIds.value = selectedAccountIds.value.filter(id => !filteredIds.includes(id))
        }
    }

    const executeExport = async () => {
        const type = currentType.value
        const variant = currentVariant.value
        let password = ''

        if (type === 'nodeauth_encrypted') {
            if (exportForm.value.password !== exportForm.value.confirm) {
                return ElMessage.error(t('migration.password_mismatch'))
            }
            if (exportForm.value.password.length < 6) {
                return ElMessage.error(t('migration.password_weak'))
            }
            password = exportForm.value.password
        }

        isExporting.value = true
        showPasswordDialog.value = false
        showWarningDialog.value = false

        try {
            loadingText.value = t('migration.fetching_accounts')
            const vault = await dataMigrationService.fetchAllVault()
            if (!vault || vault.length === 0) {
                throw new Error(t('migration.no_accounts_to_export'))
            }

            loadingText.value = type === 'nodeauth_encrypted' ? t('migration.encrypting') : t('migration.generating_file')

            // 特殊处理 Google Auth (不再直接生成，而是进入选择界面)
            if (type === 'gauth') {
                fullVault.value = vault
                // 默认全不选 (由用户的偏好修改)
                selectedAccountIds.value = []
                searchKeyword.value = ''
                showAccountSelectDialog.value = true
                isExporting.value = false
                return
            }

            if (type === 'nodeauth_html') {
                const htmlContent = await dataMigrationService.exportAsHtml(vault)
                downloadBlob(htmlContent, `nodeauth-export-html-${new Date().toISOString().split('T')[0]}.html`, 'text/html')
                ElMessage.success(t('migration.export_success'))
                isExporting.value = false
                return
            }

            const fileContent = await dataMigrationService.exportData(vault, type, password, variant)

            let filename, mimeType
            const date = new Date().toISOString().split('T')[0]

            switch (type) {
                case 'generic_text':
                    mimeType = 'text/plain'
                    filename = `nodeauth-export-otpauth-${date}.txt`
                    break
                case 'generic_csv':
                    mimeType = 'text/csv'
                    filename = `nodeauth-export-csv-${date}.csv`
                    break
                case 'bitwarden_auth_csv':
                    mimeType = 'text/csv'
                    filename = `nodeauth-export-bitwarden-auth-${date}.csv`
                    break
                case 'bitwarden_auth_json':
                    mimeType = 'application/json'
                    filename = `nodeauth-export-bitwarden-auth-${date}.json`
                    break
                case '2fas':
                    mimeType = 'application/json'
                    filename = `nodeauth-export-2fas-${date}.2fas`
                    break
                case 'generic_json':
                    mimeType = 'application/json'
                    filename = `nodeauth-export-generic-json-${date}.json`
                    break
                case 'nodeauth_encrypted':
                    mimeType = 'application/json'
                    filename = `nodeauth-backup-encrypted-${date}.json`
                    break
                case 'nodeauth_json':
                    mimeType = 'application/json'
                    filename = `nodeauth-backup-json-${date}.json`
                    break
                default:
                    // Covers 'nodeauth_html', 'aegis' etc
                    mimeType = (type === 'nodeauth_html') ? 'text/html' : 'application/json'
                    filename = `nodeauth-export-${type.replace('nodeauth_', '')}-${date}.${(type === 'nodeauth_html') ? 'html' : 'json'}`
                    break
            }

            downloadBlob(fileContent, filename, mimeType)
            ElMessage.success(t('migration.export_success'))
        } catch (error) {
            console.error('Export failed:', error)
            // fetchAllVault uses request.js (auto-toast)
            // For local errors like "no_accounts_to_export" or crypto fails, we manually toast if not handled
            if (error.message && !error.message.includes('fetch') && !error.message.includes('api_errors')) {
                ElMessage.error(error.message)
            }
        } finally {
            isExporting.value = false
        }
    }

    // 执行生成所选的 Google Auth 二维码
    const executeGaExport = async () => {
        if (selectedAccountIds.value.length === 0) {
            return ElMessage.warning(t('migration.select_account'))
        }

        isExporting.value = true
        showAccountSelectDialog.value = false
        loadingText.value = t('migration.generating_qr')

        try {
            const selectedVault = fullVault.value.filter(acc => selectedAccountIds.value.includes(acc.id))
            showGaDialog.value = true
            gaQrDataUrls.value = []
            gaCurrentIndex.value = 0
            gaQrDataUrls.value = await dataMigrationService.exportAsGaMigration(selectedVault)
        } catch (error) {
            console.error('GA Export failed:', error)
            ElMessage.error(error.message || t('common.error'))
        } finally {
            isExporting.value = false
        }
    }

    return {
        // State
        showPasswordDialog,
        showWarningDialog,
        showAccountSelectDialog,
        showGaDialog,
        isExporting,
        exportForm,
        loadingText,
        gaQrDataUrls,
        gaCurrentIndex,
        fullVault,
        searchKeyword,
        selectedAccountIds,
        filteredVault,

        // Methods
        openExportDialog,
        openWarningDialog,
        openGaDialogDirectly,
        executeExport,
        executeGaExport,
        toggleSelectAll
    }
}
