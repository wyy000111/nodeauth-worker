import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import QRCode from 'qrcode'
import { vaultService } from '@/features/vault/service/vaultService'
import { i18n } from '@/locales'

/**
 * TOTP 工具箱外部协同调度逻辑
 * 
 * 架构说明: 
 * 专门处理工具箱产生的与外部 API / 库的桥接：如触发二维码生成库 QRCode，与后端 Vault 保存 API 进行联调。
 * 这保证了 useTotpToolbox.js 作为纯状态机，不涉及第三方 UI 或非标准 API 边界效应。
 */
export function useTotpToolboxActions(toolboxState, queryClient) {
    const { t } = i18n.global
    const isSaving = ref(false)
    const showScanner = ref(false)
    const qrCodeUrl = ref('')

    // 监听 currentUri 自动重绘二维码
    watch(() => toolboxState.currentUri.value, async (newUri) => {
        if (newUri) {
            try {
                qrCodeUrl.value = await QRCode.toDataURL(newUri, { width: 200, margin: 1 })
            } catch (e) {
                qrCodeUrl.value = ''
            }
        } else {
            qrCodeUrl.value = ''
        }
    })

    const handleScanSuccess = (uri) => {
        showScanner.value = false
        const success = toolboxState.handleParsedUri(uri)
        if (success) {
            ElMessage.success(t('tools.qr_parsed'))
        } else {
            ElMessage.warning(t('vault.generate_fail'))
        }
    }

    const saveToVault = async () => {
        if (!toolboxState.secretBase32.value) return ElMessage.warning(t('tools.secret_empty'))
        if (!toolboxState.issuer.value || !toolboxState.account.value) return ElMessage.warning(t('tools.fill_info'))

        isSaving.value = true
        try {
            const res = await vaultService.createAccount({
                service: toolboxState.issuer.value,
                account: toolboxState.account.value,
                secret: toolboxState.secretBase32.value,
                digits: toolboxState.digits.value,
                period: toolboxState.period.value,
                algorithm: toolboxState.algorithm.value,
                category: t('tools.title')
            })
            if (res.success) {
                ElMessage.success(t('vault.add_success'))
                // 刷新账号列表缓存
                queryClient.invalidateQueries(['vault'])
            }
        } catch (e) {
            // Error managed by axios request interceptor & vaultService wrapping
        } finally {
            isSaving.value = false
        }
    }

    return {
        isSaving,
        showScanner,
        qrCodeUrl,
        handleScanSuccess,
        saveToVault
    }
}
