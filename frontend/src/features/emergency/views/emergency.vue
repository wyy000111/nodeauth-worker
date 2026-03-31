<template>
  <div class="emergency-container">
    <AsyncLoading v-if="isInitialLoading" />
    <div v-else class="protocol-wrapper">
      <!-- High Impact Header -->
      <header class="protocol-header">
        <div class="header-text">
          <h1>{{ $t('emergency.emergency_title') }}</h1>
          <p class="protocol-subtitle">{{ $t('emergency.emergency_subtitle') }}</p>
        </div>
      </header>

      <div class="protocol-stepper">
        <!-- Step 1: Download -->
        <section class="step-box" :class="{ 'is-completed': pdfDownloaded }">
          <div class="step-number">01</div>
          <div class="step-content">
            <h3>{{ $t('emergency.download_pdf') }}</h3>
            <p>{{ $t('emergency.save_instruction') }}</p>
            
            <el-button
              type="primary"
              size="large"
              class="huge-download-btn"
              :loading="generatingPdf"
              @click="generateEmergency"
            >
              {{ $t('emergency.download_pdf_btn') }}
            </el-button>
          </div>
          <div class="step-status" v-if="pdfDownloaded">
            <el-icon color="#67C23A"><CircleCheckFilled /></el-icon>
          </div>
        </section>

        <div class="step-divider"></div>

        <!-- Step 2: Verify (Locked until Step 1) -->
        <section class="step-box" :class="{ 'is-locked': !pdfDownloaded, 'is-active': pdfDownloaded }">
          <div class="step-number">02</div>
          <div class="step-content">
            <h3>{{ $t('emergency.verify_title') }}</h3>
            <p>{{ $t('emergency.verify_desc') }}</p>
            
            <div class="verify-input-group">
              <el-input
                v-model="verificationCode"
                placeholder="****"
                maxlength="4"
                :disabled="!pdfDownloaded"
                class="huge-verify-input"
                @keyup.enter="handleVerify"
              >
                <template #prefix>
                  <el-icon><Key /></el-icon>
                </template>
              </el-input>
              <el-button
                type="success"
                size="large"
                class="huge-verify-btn"
                :loading="verifying"
                :disabled="!pdfDownloaded || verificationCode.length !== 4"
                @click="handleVerify"
              >
                {{ $t('emergency.verify_btn') }}
              </el-button>
            </div>
          </div>
        </section>
      </div>

      <!-- Info Footer -->
      <footer class="protocol-info-footer">
        <div class="info-grid">
          <div class="info-cell">
            <div class="cell-header">
              <el-icon><InfoFilled /></el-icon>
              <label>{{ $t('emergency.importance_title') }}</label>
            </div>
            <p>{{ $t('emergency.importance_desc') }}</p>
          </div>
          <div class="info-cell">
            <div class="cell-header">
              <el-icon><WarningFilled /></el-icon>
              <label>{{ $t('emergency.pdf_self_custody') }}</label>
            </div>
            <p>{{ $t('emergency.pdf_self_custody_desc') }}</p>
          </div>
        </div>
      </footer>
    </div>

    <!-- The PDF Template (Hidden) -->
    <div style="position: absolute; left: -9999px;">
      <div id="pdf-template" class="pdf-document">
        <div class="doc-header">
          <div class="doc-brand">NodeAuth</div>
          <div class="doc-protocol">{{ $t('emergency.pdf_header').toUpperCase() }}</div>
          <div class="doc-id">KIT ID: {{ protocolId }}</div>
        </div>

        <div class="doc-body">
          <section class="doc-info">
            <div class="info-grid-pdf">
              <div><strong>{{ $t('emergency.pdf_server_url') }}</strong><br>{{ serverUrl }}</div>
              <div><strong>{{ $t('emergency.pdf_admin_email') }}</strong><br>{{ adminEmail }}</div>
              <div><strong>{{ $t('emergency.pdf_gen_date') }}</strong><br>{{ genDate }}</div>
            </div>
          </section>

          <section class="doc-key-section">
            <h2>{{ $t('emergency.pdf_key_title') }}</h2>
            <div class="doc-key-box">{{ encryptionKey }}</div>
            <p class="doc-warning">{{ $t('emergency.pdf_warning') }}</p>
          </section>

          <section class="doc-usage">
            <h3>{{ $t('emergency.pdf_usage_title') }}</h3>
            <p>{{ $t('emergency.pdf_usage_desc') }}</p>
          </section>

          <section class="doc-legal">
            <h3>{{ $t('emergency.importance_title') }}</h3>
            <p>{{ $t('emergency.importance_desc') }}</p>
          </section>

          <section class="doc-legal">
            <h3>{{ $t('emergency.pdf_self_custody') }}</h3>
            <p>{{ $t('emergency.pdf_self_custody_desc') }}</p>
          </section>
        </div>

        <div class="doc-footer">
          © {{ new Date().getFullYear() }} {{ $t('emergency.pdf_footer') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { CircleCheckFilled, Download, Key, Lock, InfoFilled, WarningFilled } from '@element-plus/icons-vue'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { authService } from '@/features/auth/service/authService'
import { AsyncLoading } from '@/shared/utils/asyncHelper'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const { t } = useI18n()
const router = useRouter()
const authUserStore = useAuthUserStore()

const encryptionKey = computed(() => authUserStore.tempEncryptionKey)
const verificationCode = ref('')
const generatingPdf = ref(false)
const verifying = ref(false)
const pdfDownloaded = ref(false)
const isInitialLoading = ref(false)

const protocolId = ref(Math.random().toString(36).substr(2, 9).toUpperCase())
const serverUrl = ref(window.location.origin)
const adminEmail = ref(authUserStore.userInfo?.email || '')
const genDate = ref(new Date().toLocaleString())

onMounted(async () => {
  if (!encryptionKey.value) {
    isInitialLoading.value = true
    try {
      // If key is missing, try to fetch it again (it's now returned by /me if needsEmergency)
      const success = await authUserStore.fetchUserInfo()
      if (!success || !encryptionKey.value) {
        ElMessage.error('Security token expired, please re-login')
        router.push('/login')
      }
    } finally {
      isInitialLoading.value = false
    }
  }
})

onUnmounted(() => {
  // 安全清理：组件销毁时立即清空内存中的根密钥
  authUserStore.tempEncryptionKey = ''
})

const generateEmergency = async () => {
  generatingPdf.value = true
  try {
    const element = document.getElementById('pdf-template')
    const canvas = await html2canvas(element, {
      scale: 3,
      useCORS: true,
      backgroundColor: '#ffffff'
    })
    
    const imgData = canvas.toDataURL('image/jpeg', 0.95)
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const imgProps = pdf.getImageProperties(imgData)
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width
    
    pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight)
    pdf.save(`${t('emergency.pdf_filename')}.pdf`)
    
    pdfDownloaded.value = true
    ElMessage.success(t('common.success'))
  } catch (error) {
    console.error('PDF Generation Failed:', error)
    ElMessage.error('Failed to generate PDF')
  } finally {
    generatingPdf.value = false
  }
}

const handleVerify = async () => {
  if (verificationCode.value.length !== 4) return
  
  verifying.value = true
  try {
    // We don't use silent: true here in authService yet, but let's check authService.js
    const res = await authService.confirmEmergency(verificationCode.value)
    if (res.success) {
      ElMessage.success(t('emergency.confirm_success'))
      authUserStore.needsEmergency = false
      authUserStore.tempEncryptionKey = ''
      router.push('/')
    }
  } catch (error) {
    // The error is already toasted by request.js interceptor if it's a 400/500
    // If we want a specific message here, we should have used silent: true
    // To fix double toast, we simply remove this local ElMessage.error
    // and let the interceptor show the translated "invalid_emergency_verification"
    verificationCode.value = ''
  } finally {
    verifying.value = false
  }
}
</script>
