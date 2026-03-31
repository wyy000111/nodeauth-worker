import { ElMessage } from 'element-plus'
import { i18n } from '@/locales'

let clipboardTimeout = null

export async function copyToClipboard(text, successMsg = i18n.global.t('common.copy_success')) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(successMsg)

    // 主动剪贴板销毁 (Active Clipboard Destruction)
    if (clipboardTimeout) {
      clearTimeout(clipboardTimeout)
    }

    clipboardTimeout = setTimeout(async () => {
      try {
        await navigator.clipboard.writeText(' ')
        ElMessage({
          message: i18n.global.t('security.clipboard_cleared') || '出于安全考虑，剪贴板已清空',
          type: 'info',
          duration: 3000,
          customClass: 'clipboard-wipe-toast'
        })
      } catch (e) {
        // iOS/Safari 等系统出于隐私保护，会禁止非用户触发(如 setTimeout)的剪贴板写操作。
        // 这里采用“尽力而为，静默失败”原则，不弹窗打扰用户。
        console.warn('Silent clipboard wipe failed due to system/context restrictions', e)
      }
    }, 60000)

  } catch (e) {
    ElMessage.error(i18n.global.t('common.copy_fail'))
    console.error('Clipboard error:', e)
  }
}

export function triggerDownload(href, filename) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  triggerDownload(url, filename)
  URL.revokeObjectURL(url)
}