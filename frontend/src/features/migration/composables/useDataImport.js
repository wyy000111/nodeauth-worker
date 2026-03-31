import { ref, computed, watch } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import { dataMigrationService } from '@/features/migration/service/dataMigrationService'
import { useVaultStore } from '@/features/vault/store/vaultStore'
import { i18n } from '@/locales'

export function useDataImport(emitFn) {
    const { t } = i18n.global
    const vaultStore = useVaultStore()

    // --- State ---
    const currentFileContent = ref('')
    const currentFile = ref(null)
    const currentImportType = ref('')
    const showDecryptDialog = ref(false)
    const importPassword = ref('')
    const importingJobs = ref(0)
    const isDecrypting = ref(false)
    const isDialogHandled = ref(false)

    // Batch properties
    const batchTotalJobs = ref(0)
    const batchProcessedJobs = ref(0)
    const batchAccumulatedVault = ref([])
    const batchErrors = ref([])
    const batchCurrentTaskName = ref('')
    const showBatchProgress = ref(false)
    const batchProgressPercent = computed(() => {
        if (batchTotalJobs.value === 0) return 0
        return Math.floor((batchProcessedJobs.value / batchTotalJobs.value) * 100)
    })

    let finalizeTimer = null

    // --- Watchers ---
    watch(importingJobs, (newVal) => {
        if (newVal === 0 && batchTotalJobs.value > 0 && !showDecryptDialog.value) {
            if (finalizeTimer) clearTimeout(finalizeTimer)
            finalizeTimer = setTimeout(() => {
                finishBatchImport()
            }, 300)
        }
    })

    // --- Core Logic ---
    const initBatchTask = (taskCount) => {
        if (batchTotalJobs.value === 0) {
            batchAccumulatedVault.value = []
            batchErrors.value = []
            showBatchProgress.value = true
        }
        importingJobs.value += taskCount
        batchTotalJobs.value += taskCount
    }

    const resetBatchState = () => {
        batchTotalJobs.value = 0
        batchProcessedJobs.value = 0
        importingJobs.value = 0
        batchAccumulatedVault.value = []
        batchErrors.value = []
        batchCurrentTaskName.value = ''
        phoneFactorGroup.value = { main: null, wal: null, shm: null }
    }

    // PhoneFactor specialized grouping
    const phoneFactorGroup = ref({ main: null, wal: null, shm: null })
    let phoneFactorTimer = null

    const processPhoneFactorGroup = async () => {
        const group = { ...phoneFactorGroup.value }
        phoneFactorGroup.value = { main: null, wal: null, shm: null } // reset

        let groupedCount = 0;
        if (group.main) groupedCount++;
        if (group.wal) groupedCount++;
        if (group.shm) groupedCount++;

        // We only proceed if we have at least *something*
        if (groupedCount === 0) return

        batchCurrentTaskName.value = t('migration.task_build_pf')
        try {
            // we pass the entire group object to the service
            const vault = await dataMigrationService.parseImportData(group, 'phonefactor_group')
            batchAccumulatedVault.value.push(...vault)
        } catch (err) {
            console.error('[PhoneFactor Group] parseImportData failed:', err)
            const detail = err && err.message ? err.message : String(err)
            batchErrors.value.push(t('migration.err_pf_parse', { detail }))
        } finally {
            batchProcessedJobs.value += groupedCount
            importingJobs.value -= groupedCount
        }
    }

    const handleFileUpload = async (uploadFile) => {
        const file = uploadFile.raw
        if (!file) return

        // we pass the entire group object to the service
        if (file.size > 10 * 1024 * 1024) {
            ElMessage.error(t('migration.file_too_large', { name: file.name }))
            return
        }

        initBatchTask(1)
        batchCurrentTaskName.value = t('migration.task_prepare', { name: file.name })

        if (file.type.startsWith('image/')) {
            await handleImageFile(file)
        } else {
            handleNonImageFile(file)
        }
    }

    const handleImageFile = async (file) => {
        try {
            batchCurrentTaskName.value = t('migration.task_scan_qr', { name: file.name })
            const vault = await dataMigrationService.parseGaQrImageFile(file)
            batchAccumulatedVault.value.push(...vault)
        } catch (err) {
            console.error(err)
            batchErrors.value.push(t('migration.err_scan_qr', { name: file.name, msg: err.message }))
        } finally {
            batchProcessedJobs.value++
            importingJobs.value--
        }
    }

    const handleNonImageFile = (file) => {
        try {
            // First pass check for PhoneFactor by filename, buffer them
            const fname = file.name.toLowerCase()
            if (fname === 'phonefactor' || fname === 'phonefactor-wal' || fname === 'phonefactor-shm') {
                const reader = new FileReader()
                reader.onload = (event) => {
                    const buffer = event.target.result
                    if (fname === 'phonefactor') phoneFactorGroup.value.main = { name: file.name, buffer }
                    else if (fname === 'phonefactor-wal') phoneFactorGroup.value.wal = { name: file.name, buffer }
                    else if (fname === 'phonefactor-shm') phoneFactorGroup.value.shm = { name: file.name, buffer }

                    // Debounce group execution
                    if (phoneFactorTimer) clearTimeout(phoneFactorTimer)
                    phoneFactorTimer = setTimeout(() => {
                        processPhoneFactorGroup()
                    }, 500)
                }
                reader.onerror = () => {
                    batchErrors.value.push(t('migration.err_read_fail', { name: file.name }))
                    batchProcessedJobs.value++
                    importingJobs.value--
                }
                reader.readAsArrayBuffer(file)
                return
            }

            currentFile.value = file
            const reader = new FileReader()

            // 无论文件名为何，都先读取成二进制，再由 detectFileType 判断类型
            reader.onload = async (event) => {
                const buffer = event.target.result
                currentFileContent.value = buffer

                const detectedType = dataMigrationService.detectFileType(buffer, file.name)
                currentImportType.value = detectedType

                if (detectedType === 'unknown') {
                    batchErrors.value.push(t('migration.err_unrecognized', { name: file.name }))
                    batchProcessedJobs.value++
                    importingJobs.value--
                    return
                }

                let contentForParse = buffer
                if (detectedType !== 'phonefactor' && detectedType !== '1password_pux') {
                    try {
                        contentForParse = new TextDecoder().decode(buffer)
                    } catch {
                        // fallback to array buffer if decoding fails; service handles it
                    }
                }

                if (detectedType === 'nodeauth_encrypted' || detectedType === 'aegis_encrypted' || detectedType === 'proton_auth_encrypted' || detectedType === 'proton_pass_pgp' || detectedType === '2fas_encrypted' || detectedType === 'ente_encrypted' || detectedType === 'bitwarden_pass_encrypted') {
                    importPassword.value = ''
                    isDialogHandled.value = false
                    showDecryptDialog.value = true
                    // keep job active until unblocked by decrypt action
                    currentFileContent.value = contentForParse
                    return
                }

                batchCurrentTaskName.value = t('migration.task_build_file', { name: file.name })
                try {
                    const vault = await dataMigrationService.parseImportData(contentForParse, detectedType)
                    batchAccumulatedVault.value.push(...vault)
                } catch (err) {
                    console.error(`[${file.name}] parseImportData failed:`, err)
                    const detail = err && err.message ? err.message : String(err)
                    batchErrors.value.push(t('migration.err_parse_fail', { name: file.name, detail }))
                } finally {
                    batchProcessedJobs.value++
                    importingJobs.value--
                }
            }

            reader.onerror = () => {
                batchErrors.value.push(t('migration.err_read_fail', { name: file.name }))
                batchProcessedJobs.value++
                importingJobs.value--
            }

            reader.readAsArrayBuffer(file)

        } catch (error) {
            console.error(error)
            batchErrors.value.push(t('migration.err_read_abnormal', { name: file.name }))
            batchProcessedJobs.value++
            importingJobs.value--
        }
    }

    const submitEncryptedData = async () => {
        if (!importPassword.value) {
            return ElMessage.warning(t('migration.import_password'))
        }

        isDecrypting.value = true
        try {
            batchCurrentTaskName.value = t('migration.task_decrypting')
            const vault = await dataMigrationService.parseImportData(
                currentFileContent.value,
                currentImportType.value,
                importPassword.value
            )
            isDialogHandled.value = true
            showDecryptDialog.value = false
            batchAccumulatedVault.value.push(...vault)
            batchProcessedJobs.value++
            importingJobs.value--
        } catch (error) {
            console.error(error)
            ElMessage.error(t('migration.password_wrong'))
        } finally {
            isDecrypting.value = false
        }
    }

    const handleDecryptDialogClose = () => {
        if (!isDialogHandled.value) {
            batchErrors.value.push(t('migration.err_user_cancel', { name: currentFile.value?.name || t('migration.encrypted_file') }))
            batchProcessedJobs.value++
            importingJobs.value--
            isDialogHandled.value = true
        }
    }

    const finishBatchImport = async () => {
        if (batchAccumulatedVault.value.length === 0) {
            // ✅ FIX 1: Give user 1200ms to read the "100% complete" state before hiding dialog
            await new Promise(resolve => setTimeout(resolve, 1200))
            showBatchProgress.value = false
            if (batchErrors.value.length > 0) {
                ElNotification({
                    title: t('migration.import_anomaly'),
                    message: batchErrors.value.join('<br>'),
                    type: 'error',
                    dangerouslyUseHTMLString: true,
                    duration: 0
                })
            } else {
                ElMessage.warning(t('migration.no_valid_data'))
            }
            resetBatchState()
            return
        }

        // 先在前端做简单的去重处理（大小写/空格不敏感），避免重复发送相同条目
        const normalize = (s, a) => `${(s || '').toString().trim().toLowerCase()}:${(a || '').toString().trim().toLowerCase()}`;
        const seen = new Set();
        const filteredVault = [];
        for (const acc of batchAccumulatedVault.value) {
            const sig = normalize(acc.service, acc.account);
            if (!seen.has(sig)) {
                seen.add(sig);
                filteredVault.push(acc);
            }
        }
        batchAccumulatedVault.value = filteredVault;
        batchCurrentTaskName.value = t('migration.task_saving', { count: batchAccumulatedVault.value.length })

        try {
            const data = await dataMigrationService.saveImportedVault(batchAccumulatedVault.value)

            // ✅ FIX 1: Wait 1200ms so user sees the 100% completion state clearly
            await new Promise(resolve => setTimeout(resolve, 1200))
            showBatchProgress.value = false

            if (data.success) {
                let msgHtml = t('migration.msg_total_files', { count: batchTotalJobs.value })
                if (data.count > 0) {
                    msgHtml += t('migration.msg_success_accounts', { count: data.count })
                } else {
                    msgHtml += t('migration.msg_no_new_accounts')
                }

                if (data.duplicates > 0) msgHtml += t('migration.msg_duplicates_skipped', { count: data.duplicates })

                if (batchErrors.value.length > 0) {
                    msgHtml += t('migration.msg_error_summary', { errors: batchErrors.value.join('<br>') })
                }

                // ✅ FIX 2: Offline (pending: true) path — add pending sync hint to message
                if (data.pending) {
                    msgHtml += t('migration.msg_offline_queued')
                }

                ElNotification({
                    title: t('migration.batch_import_finished'),
                    message: msgHtml,
                    dangerouslyUseHTMLString: true,
                    // ✅ FIX 2: Offline pending uses 'warning'; errors use 'warning'; online clean uses 'success'
                    type: (data.pending || batchErrors.value.length > 0) ? 'warning' : 'success',
                    duration: batchErrors.value.length > 0 ? 0 : 8000
                })

                // ✅ FIX 2: Offline path — still trigger redirect if count > 0 (same as online)
                if (data.count > 0) {
                    vaultStore.markDirty()
                    emitFn('success')
                }
            }

        } catch (err) {
            // ✅ FIX 1: Still delay before hiding even on error
            await new Promise(resolve => setTimeout(resolve, 1200))
            showBatchProgress.value = false
            // Log full error detail for debugging
            console.error('[finishBatchImport] Caught error:', err?.message || err, err)
            // Error already toasted by request.js

        } finally {
            resetBatchState()
        }
    }

    return {
        // State
        currentImportType,
        showDecryptDialog,
        importPassword,
        isDecrypting,
        showBatchProgress,
        batchCurrentTaskName,
        batchProcessedJobs,
        batchTotalJobs,
        batchProgressPercent,
        // Internal state (exposed for composability & testing)
        importingJobs,
        batchAccumulatedVault,
        batchErrors,
        // Handlers
        handleFileUpload,
        submitEncryptedData,
        handleDecryptDialogClose,
        // Exposed for testing
        finishBatchImport
    }
}
