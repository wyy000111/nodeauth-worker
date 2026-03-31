<template>
  <div v-if="projectId || viteProjectId">
    <el-button
      type="primary"
      size="large"
      class="oauth-btn web3-btn"
      :loading="loadingWeb3"
      :disabled="disabled || loadingWeb3"
      @click="handleWeb3Login"
    >
      <template #icon>
        <el-icon v-if="loadingWeb3" class="is-loading" color="#fff"><Loading /></el-icon>
        <el-icon v-else><iconWallet /></el-icon>
      </template>
      {{ $t('auth.web3_login') || 'Web3 Wallet Login' }}
    </el-button>

    <!-- Web3 Login Dialog (Hybrid UI: Steps for Mobile, Clean Scan for PC) -->
    <el-dialog 
      v-model="showWeb3Qr" 
      :title="isMobileWeb3 ? $t('auth.web3_auth_flow') || 'Web3安全认证流程' : $t('auth.web3_qr_title') || 'Web3安全登录'" 
      :width="isMobileWeb3 ? '360px' : '335px'" 
      center 
      append-to-body
      top="25vh"
      class="web3-auth-dialog"
      modal-class="web3-modal-overlay"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      @close="handleWeb3Close"
    >
      <div class="web3-content-wrapper">
        <!-- PC Mode: Restore Original Clean Scan Style -->
        <template v-if="!isMobileWeb3">
          <div class="web3-qr-only">
            <div class="web3-qr-wrapper">
              <canvas ref="qrCanvas"></canvas>
            </div>
            <p class="web3-qr-tip">{{ $t('auth.web3_scan_tip') || '请使用支持 WalletConnect 的钱包扫描' }}</p>
          </div>
        </template>

        <!-- Mobile Mode: Exclusive Three-Step Experience -->
        <template v-else>
          <div class="web3-mobile-steps">
            <el-steps :active="web3Step" finish-status="success" align-center class="mb-20">
              <el-step :title="$t('auth.step_connect')" />
              <el-step :title="$t('auth.step_sign')" />
              <el-step :title="$t('auth.step_verify')" />
            </el-steps>

            <div class="mobile-auth-status">
              <p v-if="web3Step === 0" class="status-msg">{{ $t('auth.web3_status_preparing') }}</p>
              <p v-else-if="web3Step === 1" class="status-msg attention-msg">{{ $t('auth.web3_notify_signature') }}</p>
              <p v-else-if="web3Step === 2" class="status-msg">{{ $t('auth.web3_status_verifying') }}</p>
            </div>

            <div class="mobile-action-group">
              <a :href="web3Uri" 
                 class="el-button el-button--large web3-dynamic-btn"
                 @click="web3ActionLoading = true"
                 :class="{ 
                   'btn-connect': web3Step === 0, 
                   'btn-sign': web3Step === 1,
                   'btn-verify': web3Step === 2 
                 }"
              >
                <el-icon v-if="web3ActionLoading || web3Step === 2" class="is-loading" color="#fff"><Loading /></el-icon>
                <span v-if="web3Step === 0">{{ $t('auth.web3_action_connect') }}</span>
                <span v-else-if="web3Step === 1">{{ $t('auth.web3_action_sign') }}</span>
                <span v-else>{{ $t('auth.web3_action_verifying') }}</span>
              </a>

              <div class="fallback-copy mt-15" v-if="web3Step < 2">
                <p class="tiny-label">{{ $t('auth.web3_fallback_tip') }}</p>
                <el-input v-model="web3Uri" readonly size="small">
                  <template #append>
                    <el-button @click="copyWeb3Uri" :icon="CopyDocument" />
                  </template>
                </el-input>
              </div>
            </div>
          </div>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { Loading, CopyDocument } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import iconWallet from '@/shared/components/icons/iconWallet.vue'
import { web3WalletAuthService } from '@/features/auth/service/web3WalletAuthService'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { setIdbItem } from '@/shared/utils/idb'
import QRCode from 'qrcode'

const props = defineProps({
  projectId: {
    type: String,
    default: ''
  },
  relayUrl: {
    type: String,
    default: ''
  },
  verifyUrl: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['loading-start', 'loading-end'])

const { t } = useI18n()
const router = useRouter()
const authUserStore = useAuthUserStore()

const viteProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID

const loadingWeb3 = ref(false)
const showWeb3Qr = ref(false)
const qrCanvas = ref(null)
const isMobileWeb3 = ref(false)
const web3Uri = ref('')
const web3Step = ref(0) // 0: Connect, 1: Sign, 2: Verification/Success
const web3ActionLoading = ref(false)

const copyWeb3Uri = async () => {
  try {
    await navigator.clipboard.writeText(web3Uri.value)
    ElMessage.success(t('common.copied') || 'Copied successfully')
  } catch (err) {
    ElMessage.error(t('common.error') || 'Copy failed')
  }
}

const handleWeb3Login = async () => {
  // Prefer projectId from backend (via props) and fall back to build-time env.
  // The button is hidden by v-if when both are empty, so this is always a valid ID.
  const wcProjectId = props.projectId || viteProjectId;
  loadingWeb3.value = true
  emit('loading-start')
  
  try {
    const res = await web3WalletAuthService.login(wcProjectId, {
      relayUrl: props.relayUrl,
      verifyUrl: props.verifyUrl,
      onUri: async (uri, isMobile) => {
        showWeb3Qr.value = true
        isMobileWeb3.value = !!isMobile
        web3Uri.value = uri
        web3Step.value = 0
        
        if (!isMobile) {
          // Await nextTick so the canvas element is guaranteed to be in the DOM
          // before attempting to render the QR code, eliminating the race condition.
          await nextTick()
          if (qrCanvas.value) {
            await QRCode.toCanvas(qrCanvas.value, uri, { width: 280, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
          }
        }
      },
      onStatus: (status) => {
        if (status === 'reconnecting') {
          web3Step.value = 0
          web3ActionLoading.value = false
        }
        if (status === 'awaiting_signature') {
          web3Step.value = 1
          web3ActionLoading.value = false
        }
        if (status === 'verifying') {
          web3Step.value = 2
          web3ActionLoading.value = false
        }
      }
    })
    
    if (res && res.success) {
      // Success path: close UI immediately, then navigate away.
      // Do NOT touch loadingWeb3 here so the button stays in its loading state
      // during the navigation transition, preventing accidental double-clicks.
      showWeb3Qr.value = false
      await authUserStore.setUserInfo(res.userInfo, !!res.needsEmergency, res.encryptionKey || '')
      if (res.deviceKey) {
        await setIdbItem('sys:sec:device_salt', res.deviceKey)
      }
      
      ElMessage.success(t('common.success'))
      if (res.needsEmergency) {
        router.push('/emergency')
      } else {
        window.location.href = '/'
      }
      // Return early: skip finally cleanup so the button stays locked
      // for the duration of the navigation.
      return
    }
  } catch (error) {
    console.error('Web3 login failed:', error)
    const errorMsg = error.message || ''
    
    if (errorMsg.includes('Invalid WalletConnect Project ID')) {
      ElMessage.error('WalletConnect Configuration Error: Project ID not found. Please register at cloud.walletconnect.com.')
    } else if (errorMsg !== 'User cancelled') {
      const msg = errorMsg.includes('not_whitelisted') ? t('api_errors.not_whitelisted') : errorMsg
      ElMessage.error(msg || t('api_errors.request_failed'))
    }
  } finally {
    // Only reached on error or cancel — not on successful navigation (early return above).
    loadingWeb3.value = false
    showWeb3Qr.value = false
    emit('loading-end')
  }
}

const handleWeb3Close = () => {
  // Always reset all dialog-local state regardless of loading status,
  // so the next open starts from a clean slate.
  web3Step.value = 0
  web3ActionLoading.value = false
  isMobileWeb3.value = false
  web3Uri.value = ''

  if (loadingWeb3.value) {
    loadingWeb3.value = false
    web3WalletAuthService.disconnect()
    emit('loading-end')
  }
}
</script>
