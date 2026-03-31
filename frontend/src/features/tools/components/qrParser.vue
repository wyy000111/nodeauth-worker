<template>
  <div class="tool-pane">
    <div class="qr-parser-container">
      <!-- Use QrScanner Component -->
      <QrScanner @scan-success="handleScanSuccess" />

      <!-- Result Display -->
      <div v-if="scanResult" class="result-section mt-20">
        <el-divider content-position="left">{{ $t('tools.qr_result') }}</el-divider>
        <el-input v-model="scanResult" type="textarea" :rows="3" readonly resize="none" />
        <el-button type="success" plain class="w-full mt-10" @click="copyResult">
          <el-icon><CopyDocument /></el-icon> {{ $t('common.copy') }}
        </el-button>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, defineAsyncComponent } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument } from '@element-plus/icons-vue'
import { i18n } from '@/locales'

// Import QrScanner component
const QrScanner = defineAsyncComponent(() => import('@/shared/components/qrScanner.vue'))

const scanResult = ref('')

const { t } = i18n.global

const handleScanSuccess = (result) => {
  scanResult.value = result
  ElMessage.success(t('tools.qr_parsed'))
}

const copyResult = async () => {
  if (!scanResult.value) return
  try { await navigator.clipboard.writeText(scanResult.value); ElMessage.success(t('tools.password_copied')) } catch (e) {}
}
</script>