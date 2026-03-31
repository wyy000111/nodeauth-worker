import { ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { i18n } from '@/locales'
import { useBackupStore } from '@/features/backup/store/backupStore'

export function useBackupUI(onRevoked) {
    const { t } = i18n.global
    const backupStore = useBackupStore()

    // Backup Action State
    const showBackupDialog = ref(false)
    const backupPassword = ref('')
    const isBackingUp = ref(false)
    const useAutoPassword = ref(false)
    const currentActionProvider = ref(null)
    const checkingBackupProviderId = ref(null)  // Per-provider loading state for backup button (OAuth pre-check)

    // Restore Action State
    const showRestoreListDialog = ref(false)
    const isLoadingFiles = ref(false)
    const checkingRestoreProviderId = ref(null)  // Per-provider loading state for restore button
    const backupFiles = ref([])
    const showRestoreConfirmDialog = ref(false)
    const restorePassword = ref('')
    const selectedFile = ref(null)
    const isRestoring = ref(false)

    // Helper: show a confirm dialog with a "Re-authorize" action button
    const showRevokedConfirm = (provider) => {
        backupStore.markAsRevoked(provider.id)
        ElMessageBox.confirm(
            t('backup.token_expired_or_revoked'),
            t('common.warning'),
            {
                type: 'warning',
                confirmButtonText: t('backup.re_authorize'),
                cancelButtonText: t('common.close'),
            }
        ).then(() => {
            // User clicked "Re-authorize": open the provider edit dialog
            if (onRevoked) onRevoked(provider)
        }).catch(() => { /* User closed */ })
    }

    return {
        showBackupDialog, backupPassword, isBackingUp, useAutoPassword, currentActionProvider, checkingBackupProviderId,
        showRestoreListDialog, isLoadingFiles, checkingRestoreProviderId, backupFiles, showRestoreConfirmDialog, restorePassword,
        selectedFile, isRestoring, showRevokedConfirm
    }
}
