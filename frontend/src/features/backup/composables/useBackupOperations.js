import { ElMessage, ElNotification, ElMessageBox } from 'element-plus'
import { backupService } from '@/features/backup/service/backupService'
import { dataMigrationService } from '@/features/migration/service/dataMigrationService'
import { useVaultStore } from '@/features/vault/store/vaultStore'
import { i18n } from '@/locales'

const OAUTH_PROVIDER_TYPES = ['gdrive', 'onedrive']

export function useBackupOperations(uiState, emit, fetchProviders) {
    const { t } = i18n.global
    const vaultStore = useVaultStore()

    const openBackupDialog = async (provider) => {
        if (OAUTH_PROVIDER_TYPES.includes(provider.type)) {
            uiState.checkingBackupProviderId.value = provider.id
            try {
                await backupService.testConnection(provider.type, provider.config, provider.id)
            } catch (e) {
                const isAuthError = e.isOAuthRevoked || e.message?.includes('oauth_token_revoked')
                    || e.details?.isOAuthRevoked || e.details?.message?.includes('oauth_token_revoked')
                if (isAuthError) {
                    uiState.checkingBackupProviderId.value = null
                    return uiState.showRevokedConfirm(provider)
                }
            } finally {
                uiState.checkingBackupProviderId.value = null
            }
        }
        uiState.currentActionProvider.value = provider
        uiState.backupPassword.value = ''
        uiState.useAutoPassword.value = !!provider.auto_backup
        uiState.showBackupDialog.value = true
    }

    const handleBackup = async () => {
        if (!uiState.useAutoPassword.value && uiState.backupPassword.value.length < 6) {
            return ElMessage.warning(t('backup.password_min_length'))
        }

        const pwdToSend = uiState.useAutoPassword.value ? '' : uiState.backupPassword.value
        uiState.isBackingUp.value = true
        try {
            const res = await backupService.triggerBackup(uiState.currentActionProvider.value.id, pwdToSend)
            if (res.success) {
                ElNotification({
                    title: t('backup.backup_finish_title'),
                    message: `<div style="color:var(--el-color-success)">🎉 ${t('backup.backup_success_msg')}</div>`,
                    dangerouslyUseHTMLString: true,
                    type: 'success',
                    duration: 5000
                })
                uiState.showBackupDialog.value = false
                if (fetchProviders) await fetchProviders()
            }
        } catch (e) {
            const isAuthError = e.isOAuthRevoked || e.message?.includes('oauth_token_revoked');
            if (isAuthError) {
                uiState.showBackupDialog.value = false
                uiState.showRevokedConfirm(uiState.currentActionProvider.value)
            }
        } finally { uiState.isBackingUp.value = false }
    }

    const openRestoreDialog = async (provider) => {
        uiState.currentActionProvider.value = provider
        uiState.checkingRestoreProviderId.value = provider.id
        try {
            const res = await backupService.getBackupFiles(provider.id)
            if (res.success) {
                uiState.backupFiles.value = res.files
                uiState.showRestoreListDialog.value = true
            }
        } catch (e) {
            const isAuthError = e.isOAuthRevoked || e.message?.includes('oauth_token_revoked');
            if (isAuthError) {
                uiState.showRevokedConfirm(provider)
            }
        } finally { uiState.checkingRestoreProviderId.value = null }
    }

    const selectRestoreFile = (file) => {
        uiState.selectedFile.value = file
        uiState.restorePassword.value = ''
        uiState.showRestoreConfirmDialog.value = true
    }

    const handleRestore = async () => {
        uiState.isRestoring.value = true
        try {
            const downloadRes = await backupService.downloadBackupFile(uiState.currentActionProvider.value.id, uiState.selectedFile.value.filename, true)

            let contentToDecrypt = downloadRes.content
            try {
                const json = typeof contentToDecrypt === 'string' ? JSON.parse(contentToDecrypt) : contentToDecrypt
                if (json && json.encrypted && json.data) {
                    contentToDecrypt = json.data
                }
            } catch (e) { }

            const vault = await dataMigrationService.parseImportData(contentToDecrypt, 'nodeauth_encrypted', uiState.restorePassword.value)
            const saveRes = await dataMigrationService.saveImportedVault(vault)

            if (saveRes.success) {
                let msgHtml = `<div>${t('backup.processed_total')} <b>1</b> ${t('backup.backup_files_count')} (${vault.length} ${t('backup.base_accounts_count')})。</div>`
                if (saveRes.count > 0) {
                    msgHtml += `<div style="color:var(--el-color-success)">🎉 ${t('backup.import_success_count')} <b>${saveRes.count}</b> ${t('backup.new_accounts')}</div>`
                } else {
                    msgHtml += `<div style="color:var(--el-color-warning)">⚠️ ${t('backup.no_new_accounts')}</div>`
                }
                if (saveRes.duplicates > 0) msgHtml += `<div style="color:var(--el-text-color-secondary)">ℹ️ ${t('backup.skipped_duplicates')} <b>${saveRes.duplicates}</b> ${t('backup.existing_accounts')}</div>`

                ElNotification({
                    title: t('backup.restore_finish_title'),
                    message: msgHtml,
                    dangerouslyUseHTMLString: true,
                    type: 'success',
                    duration: 8000
                })

                uiState.showRestoreConfirmDialog.value = false
                uiState.showRestoreListDialog.value = false
                if (saveRes.count > 0) {
                    vaultStore.markDirty()
                    emit('restore-success')
                }
            }
        } catch (e) {
            const isAuthError = e.isOAuthRevoked || e.message?.includes('oauth_token_revoked');
            if (isAuthError) {
                uiState.showRestoreConfirmDialog.value = false
                uiState.showRestoreListDialog.value = false
                uiState.showRevokedConfirm(uiState.currentActionProvider.value)
                return
            }

            if (e.message?.includes('FILE_UNAVAILABLE')) {
                uiState.showRestoreConfirmDialog.value = false
                ElMessageBox.confirm(
                    t('backup.file_unavailable'),
                    t('backup.record_invalid'),
                    {
                        confirmButtonText: t('backup.confirm_clean'),
                        cancelButtonText: t('backup.cancel_clean'),
                        type: 'warning'
                    }
                ).then(async () => {
                    try {
                        await backupService.deleteBackupFile(uiState.currentActionProvider.value.id, uiState.selectedFile.value.filename)
                        if (uiState.selectedFile.value) {
                            uiState.backupFiles.value = uiState.backupFiles.value.filter(f => f.filename !== uiState.selectedFile.value.filename)
                        }
                        ElMessage.success(t('backup.clean_record_success'))
                    } catch (err) {
                        ElMessage.error(err.message || t('backup.clean_record_fail'))
                    }
                }).catch(() => { })
            } else if (!e.message?.includes('connection_failed')) {
                ElMessage.error(e.message || t('backup.restore_fail'))
            }
        } finally { uiState.isRestoring.value = false }
    }

    return {
        openBackupDialog,
        handleBackup,
        openRestoreDialog,
        selectRestoreFile,
        handleRestore
    }
}
