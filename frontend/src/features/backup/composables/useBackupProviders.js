import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { storeToRefs } from 'pinia'
import { backupService } from '@/features/backup/service/backupService'
import { i18n } from '@/locales'
import { useBackupStore } from '@/features/backup/store/backupStore'

export function useBackupProviders() {
    const { t } = i18n.global
    const backupStore = useBackupStore()


    const { providers, isLoading } = storeToRefs(backupStore)
    const { fetchProviders: storeFetch } = backupStore
    const availableTypes = ref(['s3', 'telegram', 'webdav', 'email']) // Default types (mirrors backend hardcoded base; OAuth types added dynamically by API)

    // Form and Dialog State
    const showConfigDialog = ref(false)
    const isEditing = ref(false)
    const isTesting = ref(false)
    const isSaving = ref(false)
    const testingProviderIds = ref({}) // { providerId: true }
    const testResults = ref({}) // { providerId: 'success' | 'error' }

    const isEditingWebdavPwd = ref(false)
    const isEditingS3Secret = ref(false)
    const isEditingTelegramToken = ref(false)
    const isEditingEmailPwd = ref(false)
    const isAuthenticatingGoogle = ref(false)
    const isAuthenticatingMicrosoft = ref(false)
    const isAuthenticatingBaidu = ref(false)
    const isAuthenticatingDropbox = ref(false)
    const authStatusGoogle = ref(null) // null, 'success', 'error'
    const authStatusMicrosoft = ref(null)
    const authStatusBaidu = ref(null)
    const authStatusDropbox = ref(null)
    const authErrorMessageGoogle = ref('')
    const authErrorMessageMicrosoft = ref('')
    const authErrorMessageBaidu = ref('')
    const authErrorMessageDropbox = ref('')

    const initialFormState = () => ({
        type: 'email',
        name: '',
        config: {
            // WebDAV
            url: '', username: '', password: '', saveDir: '/nodeauth-backup',
            // S3
            endpoint: '', bucket: '', region: 'auto', accessKeyId: '', secretAccessKey: '',
            // Telegram
            botToken: '', chatId: '',
            // OAuth (gdrive/onedrive/baidu/dropbox)
            refreshToken: '', folderId: '',
            // Email
            smtpHost: '', smtpPort: '587', smtpSecure: false, smtpUser: '', smtpPassword: '', smtpFrom: '', smtpTo: ''
        },
        autoBackup: false,
        autoBackupPassword: '',
        autoBackupRetain: 30
    })

    const form = ref(initialFormState())
    const currentProviderId = ref(null)
    const isAutoBackupPasswordSaved = ref(false)
    const shouldUseExistingAutoBackupPassword = ref(false)

    // Methods
    const fetchProviders = async () => {
        // Use cached data first if available
        const cachedProviders = await backupStore.loadLocalCache()
        if (cachedProviders && Array.isArray(cachedProviders)) {
            backupStore.providers = cachedProviders
        }

        try {
            await storeFetch()
            // Sync available types if backend provides them
            const res = await backupService.getProviders() // Re-fetch to get availableTypes
            if (res.availableTypes) {
                availableTypes.value = res.availableTypes
            }
            await backupStore.saveLocalCache(backupStore.providers)
        } catch (e) {
            console.error('[useBackupProviders] fetch failed:', e)
        }
    }


    // Helper to completely reset auth-related internal states
    const resetAuthStatuses = () => {
        authStatusGoogle.value = null
        authStatusMicrosoft.value = null
        authStatusBaidu.value = null
        authStatusDropbox.value = null
        authErrorMessageGoogle.value = ''
        authErrorMessageMicrosoft.value = ''
        authErrorMessageBaidu.value = ''
        authErrorMessageDropbox.value = ''
        isAuthenticatingGoogle.value = false
        isAuthenticatingMicrosoft.value = false
        isAuthenticatingBaidu.value = false
        isAuthenticatingDropbox.value = false
    }

    const openAddDialog = () => {
        isEditing.value = false
        isEditingWebdavPwd.value = false
        isEditingS3Secret.value = false
        isEditingTelegramToken.value = false
        isEditingEmailPwd.value = false
        resetAuthStatuses()
        form.value = initialFormState()
        isAutoBackupPasswordSaved.value = false
        shouldUseExistingAutoBackupPassword.value = false
        showConfigDialog.value = true
    }

    const editProvider = (provider) => {
        isEditing.value = true
        isEditingWebdavPwd.value = false
        isEditingS3Secret.value = false
        isEditingTelegramToken.value = false
        isEditingEmailPwd.value = false
        resetAuthStatuses()
        currentProviderId.value = provider.id
        form.value = JSON.parse(JSON.stringify({
            type: provider.type,
            name: provider.name,
            config: provider.config,
            autoBackup: !!provider.auto_backup,
            autoBackupPassword: '',
            autoBackupRetain: provider.auto_backup_retain ?? 30
        }))
        isAutoBackupPasswordSaved.value = !!provider.auto_backup_password
        shouldUseExistingAutoBackupPassword.value = true
        showConfigDialog.value = true
    }

    const validateForm = () => {
        if (!form.value.name) return t('backup.require_name')
        const config = form.value.config
        if (form.value.type === 'webdav') {
            if (!config.url) return t('backup.require_webdav_url')
            if (!config.username) return t('backup.require_username')
            if (!config.password) return t('backup.require_password')
        } else if (form.value.type === 's3') {
            if (!config.endpoint) return t('backup.require_endpoint')
            if (!config.bucket) return t('backup.require_bucket')
            if (!config.accessKeyId) return t('backup.require_access_key')
            if (!config.secretAccessKey) return t('backup.require_secret_key')
        } else if (form.value.type === 'telegram') {
            if (!config.botToken) return t('backup.require_telegram_token')
            if (!config.chatId) return t('backup.require_telegram_chat_id')
        } else if (form.value.type === 'gdrive') {
            if (!config.refreshToken) return t('backup.require_google_auth')
        } else if (form.value.type === 'onedrive') {
            if (!config.refreshToken) return t('backup.require_microsoft_auth')
        } else if (form.value.type === 'baidu') {
            if (!config.refreshToken) return t('backup.require_baidu_auth')
        } else if (form.value.type === 'dropbox') {
            if (!config.refreshToken) return t('backup.require_dropbox_auth')
        } else if (form.value.type === 'email') {
            if (!config.smtpHost) return t('backup.require_email_smtp_host')
            if (!config.smtpUser) return t('backup.require_email_smtp_user')
            if (!config.smtpPassword) return t('backup.require_email_smtp_password')
            if (!config.smtpTo) return t('backup.require_email_smtp_to')
        }

        if (form.value.autoBackup) {
            if (isEditing.value && isAutoBackupPasswordSaved.value && shouldUseExistingAutoBackupPassword.value) {
                return null
            }
            if (!form.value.autoBackupPassword || form.value.autoBackupPassword.length < 6) {
                return t('backup.password_min_length')
            }
        }
        return null
    }

    const testConnection = async (provider = null) => {
        const isIndividual = !!provider
        const targetData = isIndividual ? provider : form.value
        const targetId = isIndividual ? provider.id : (isEditing.value ? currentProviderId.value : null)

        if (!isIndividual) {
            const error = validateForm()
            if (error) return ElMessage.warning(error)
        }

        if (isIndividual) {
            testingProviderIds.value[targetId] = true
        } else {
            isTesting.value = true
        }

        // Only reset error states, keep 'success' state if it exists
        if (authStatusGoogle.value === 'error') authStatusGoogle.value = null;
        authErrorMessageGoogle.value = '';
        if (authStatusMicrosoft.value === 'error') authStatusMicrosoft.value = null;
        authErrorMessageMicrosoft.value = '';
        if (authStatusBaidu.value === 'error') authStatusBaidu.value = null;
        authErrorMessageBaidu.value = '';
        if (authStatusDropbox.value === 'error') authStatusDropbox.value = null;
        authErrorMessageDropbox.value = '';

        try {
            const res = await backupService.testConnection(
                targetData.type,
                targetData.config,
                targetId
            )
            if (res.success) {
                ElMessage.success(t('backup.test_success'))

                if (isIndividual) {
                    testResults.value[targetId] = 'success'
                }

                // Ensure the success status is reflected in the UI for OAuth providers
                const type = targetData.type
                if (type === 'gdrive') authStatusGoogle.value = 'success'
                else if (type === 'onedrive') authStatusMicrosoft.value = 'success'
                else if (type === 'baidu') authStatusBaidu.value = 'success'
                else if (type === 'dropbox') authStatusDropbox.value = 'success'
            }
        } catch (e) {
            // Error is handled here natively since we silenced the global request.js interceptor for testConnection
            const rawMsg = e?.details?.message || e?.message || e?.response?.data?.message || (typeof e === 'string' ? e : t('common.error'));
            const errMsg = rawMsg.toLowerCase();

            // Listen for the standard project-level OAuth revocation signal
            if (errMsg.includes('oauth_token_revoked')) {
                const type = targetData.type;
                console.error(`[OAuth Auth Check] The authorization token for ${type} is revoked or expired. Attempting UI reset...`, e);

                // Reset the internal token holder
                if (!isIndividual) {
                    form.value.config.refreshToken = '';
                }

                // Switch UI back to authentication state
                if (type === 'gdrive') {
                    authStatusGoogle.value = 'error';
                    authErrorMessageGoogle.value = t('backup.token_expired_or_revoked');
                } else if (type === 'onedrive') {
                    authStatusMicrosoft.value = 'error';
                    authErrorMessageMicrosoft.value = t('backup.token_expired_or_revoked');
                } else if (type === 'baidu') {
                    authStatusBaidu.value = 'error';
                    authErrorMessageBaidu.value = t('backup.token_expired_or_revoked');
                } else if (type === 'dropbox') {
                    authStatusDropbox.value = 'error';
                    authErrorMessageDropbox.value = t('backup.token_expired_or_revoked');
                }

                // If we are editing an existing provider, update the global store to reflect the state
                if (targetId) {
                    backupStore.markAsRevoked(targetId);
                }
            } else {
                // Mirror the same colon-splitting + layered-translation logic as request.js
                // but improved to handle multiple colon-separated segments for deeper errors like SMTP
                const parts = typeof rawMsg === 'string' ? rawMsg.split(':') : [rawMsg];
                const translatedParts = parts.map((part, index) => {
                    const trimmed = part.trim();
                    const i18nKey = `api_errors.${trimmed.toLowerCase()}`;
                    // Only translate if it's a known error key, otherwise keep original (technical details/codes)
                    return i18n.global.te(i18nKey) ? i18n.global.t(i18nKey) : trimmed;
                });

                // Join back with colons, but beautify spacing: 'Error: Detail'
                ElMessage.error(translatedParts.join(': '));
            }
            if (isIndividual) {
                testResults.value[targetId] = 'error'
            }
        } finally {
            if (isIndividual) {
                delete testingProviderIds.value[targetId]
            } else {
                isTesting.value = false
            }
        }
    }

    const saveProvider = async () => {
        const error = validateForm()
        if (error) return ElMessage.warning(error)

        if (isEditing.value && isAutoBackupPasswordSaved.value && shouldUseExistingAutoBackupPassword.value) {
            form.value.autoBackupPassword = ''
        }

        isSaving.value = true
        try {
            const res = isEditing.value
                ? await backupService.updateProvider(currentProviderId.value, form.value)
                : await backupService.createProvider(form.value)
            if (res.success) {
                ElMessage.success(t('backup.save_success'))
                showConfigDialog.value = false
                await fetchProviders()
            }
        } catch (e) {
            // Already handled by request.js
        } finally { isSaving.value = false }
    }

    const deleteProvider = async (provider) => {
        try {
            await ElMessageBox.confirm(t('backup.delete_provider_confirm'), t('common.warning'), { type: 'warning' })
            await backupService.deleteProvider(provider.id)
            await fetchProviders()
        } catch (e) {
            // Error handled by request.js (unless it's 'cancel' from ElMessageBox)
        }
    }

    const startGoogleAuth = async () => {
        isAuthenticatingGoogle.value = true
        authStatusGoogle.value = null
        authErrorMessageGoogle.value = ''
        try {
            const res = await backupService.getGoogleAuthUrl()
            if (res.success && res.authUrl) {
                const name = 'google_auth'
                const specs = 'width=600,height=700,left=200,top=100'
                const authWindow = window.open(res.authUrl, name, specs)

                // 检查窗口是否被关闭
                const timer = setInterval(() => {
                    try {
                        // COOP 可能导致访问 authWindow.closed 报错，这里用 try-catch 保护
                        if (authWindow && authWindow.closed) {
                            clearInterval(timer)
                            // 若窗口关闭且仍未成功，重置加载状态
                            if (isAuthenticatingGoogle.value && !authStatusGoogle.value) {
                                isAuthenticatingGoogle.value = false
                            }
                        }
                    } catch (e) {
                        // 访问被拒绝说明窗口已经跳转到不同策略的域
                        // 我们不需要报错，因为我们有 BroadcastChannel 兜底
                    }
                }, 1000)
            } else {
                isAuthenticatingGoogle.value = false
            }
        } catch (e) {
            isAuthenticatingGoogle.value = false
        }
    }

    const startMicrosoftAuth = async () => {
        isAuthenticatingMicrosoft.value = true
        authStatusMicrosoft.value = null
        authErrorMessageMicrosoft.value = ''
        try {
            const res = await backupService.getMicrosoftAuthUrl()
            if (res.success && res.authUrl) {
                const name = 'microsoft_auth'
                const specs = 'width=600,height=700,left=200,top=100'
                const authWindow = window.open(res.authUrl, name, specs)

                const timer = setInterval(() => {
                    try {
                        if (authWindow && authWindow.closed) {
                            clearInterval(timer)
                            if (isAuthenticatingMicrosoft.value && !authStatusMicrosoft.value) {
                                isAuthenticatingMicrosoft.value = false
                            }
                        }
                    } catch (e) { }
                }, 1000)
            } else {
                isAuthenticatingMicrosoft.value = false
            }
        } catch (e) {
            isAuthenticatingMicrosoft.value = false
        }
    }

    const startBaiduAuth = async () => {
        isAuthenticatingBaidu.value = true
        authStatusBaidu.value = null
        authErrorMessageBaidu.value = ''
        try {
            const res = await backupService.getBaiduAuthUrl()
            if (res.success && res.authUrl) {
                const name = 'baidu_auth'
                const specs = 'width=600,height=700,left=200,top=100'
                const authWindow = window.open(res.authUrl, name, specs)

                const timer = setInterval(() => {
                    try {
                        if (authWindow && authWindow.closed) {
                            clearInterval(timer)
                            if (isAuthenticatingBaidu.value && !authStatusBaidu.value) {
                                isAuthenticatingBaidu.value = false
                            }
                        }
                    } catch (e) { }
                }, 1000)
            } else {
                isAuthenticatingBaidu.value = false
            }
        } catch (e) {
            isAuthenticatingBaidu.value = false
        }
    }

    const startDropboxAuth = async () => {
        isAuthenticatingDropbox.value = true
        authStatusDropbox.value = null
        authErrorMessageDropbox.value = ''
        try {
            const res = await backupService.getDropboxAuthUrl()
            if (res.success && res.authUrl) {
                const name = 'dropbox_auth'
                const specs = 'width=600,height=700,left=200,top=100'
                const authWindow = window.open(res.authUrl, name, specs)

                const timer = setInterval(() => {
                    try {
                        if (authWindow && authWindow.closed) {
                            clearInterval(timer)
                            if (isAuthenticatingDropbox.value && !authStatusDropbox.value) {
                                isAuthenticatingDropbox.value = false
                            }
                        }
                    } catch (e) { }
                }, 1000)
            } else {
                isAuthenticatingDropbox.value = false
            }
        } catch (e) {
            isAuthenticatingDropbox.value = false
        }
    }

    const handleAuthMessage = async (event) => {
        const data = event instanceof MessageEvent ? event.data : event
        if (!data || !data.type) return

        if (data.type === 'GDRIVE_AUTH_SUCCESS') {
            isAuthenticatingGoogle.value = false
            authStatusGoogle.value = 'success'
            form.value.config.refreshToken = data.refreshToken
            if (!form.value.config.saveDir) {
                form.value.config.saveDir = '/nodeauth-backup'
            }
        } else if (data.type === 'GDRIVE_AUTH_ERROR') {
            isAuthenticatingGoogle.value = false
            authStatusGoogle.value = 'error'
            authErrorMessageGoogle.value = data.message || t('backup.google_auth_failed')
        } else if (data.type === 'MS_AUTH_SUCCESS') {
            isAuthenticatingMicrosoft.value = false
            authStatusMicrosoft.value = 'success'
            form.value.config.refreshToken = data.refreshToken
            if (!form.value.config.saveDir) {
                form.value.config.saveDir = '/nodeauth-backup'
            }
        } else if (data.type === 'MS_AUTH_ERROR') {
            isAuthenticatingMicrosoft.value = false
            authStatusMicrosoft.value = 'error'
            authErrorMessageMicrosoft.value = data.message || t('backup.microsoft_auth_failed')
        } else if (data.type === 'BAIDU_AUTH_SUCCESS') {
            isAuthenticatingBaidu.value = false
            authStatusBaidu.value = 'success'
            form.value.config.refreshToken = data.refreshToken
            if (!form.value.config.saveDir) {
                form.value.config.saveDir = '/apps/nodeauth-backup'
            }
        } else if (data.type === 'BAIDU_AUTH_ERROR') {
            isAuthenticatingBaidu.value = false
            authStatusBaidu.value = 'error'
            authErrorMessageBaidu.value = data.message || t('backup.baidu_auth_failed')
        } else if (data.type === 'DROPBOX_AUTH_SUCCESS') {
            isAuthenticatingDropbox.value = false
            authStatusDropbox.value = 'success'
            form.value.config.refreshToken = data.refreshToken
            if (!form.value.config.saveDir) {
                form.value.config.saveDir = ''
            }
        } else if (data.type === 'DROPBOX_AUTH_ERROR') {
            isAuthenticatingDropbox.value = false
            authStatusDropbox.value = 'error'
            authErrorMessageDropbox.value = data.message || t('backup.dropbox_auth_failed')
        }
    }

    const setupAuthListener = (onMessage) => {
        const handleMsg = (e) => {
            // Security: Always verify origin for window message events
            if (e instanceof MessageEvent && e.origin !== window.location.origin && e.source !== window) {
                // BroadcastChannel events are same-origin by design, but window.postMessage needs this check
                if (e.origin !== window.location.origin) return;
            }
            onMessage(e)
            handleAuthMessage(e)
        }

        // 1. Listen via postMessage
        window.addEventListener('message', handleMsg)

        // 2. Listen via BroadcastChannel (More robust)
        const bcGDrive = new BroadcastChannel('gdrive_oauth_channel')
        bcGDrive.onmessage = handleMsg

        const bcMs = new BroadcastChannel('ms_oauth_channel')
        bcMs.onmessage = handleMsg

        const bcBaidu = new BroadcastChannel('baidu_oauth_channel')
        bcBaidu.onmessage = handleMsg

        const bcDropbox = new BroadcastChannel('dropbox_oauth_channel')
        bcDropbox.onmessage = handleMsg

        return () => {
            window.removeEventListener('message', handleMsg)
            bcGDrive.close()
            bcMs.close()
            bcBaidu.close()
            bcDropbox.close()
        }
    }

    onMounted(fetchProviders)

    return {
        providers,
        isLoading,
        showConfigDialog,
        isEditing,
        isTesting,
        isSaving,
        testingProviderIds,
        testResults,
        isEditingWebdavPwd,
        isEditingS3Secret,
        isEditingTelegramToken,
        isEditingEmailPwd,
        isAuthenticatingGoogle,
        isAuthenticatingMicrosoft,
        isAuthenticatingBaidu,
        isAuthenticatingDropbox,
        authStatusGoogle,
        authStatusMicrosoft,
        authStatusBaidu,
        authStatusDropbox,
        authErrorMessageGoogle,
        authErrorMessageMicrosoft,
        authErrorMessageBaidu,
        authErrorMessageDropbox,
        form,
        isAutoBackupPasswordSaved,
        shouldUseExistingAutoBackupPassword,
        fetchProviders,
        openAddDialog,
        editProvider,
        testConnection,
        saveProvider,
        deleteProvider,
        startGoogleAuth,
        startMicrosoftAuth,
        startBaiduAuth,
        startDropboxAuth,
        handleAuthMessage,
        setupAuthListener,
        availableTypes
    }
}
