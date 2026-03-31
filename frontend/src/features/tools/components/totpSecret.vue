<template>
  <div class="tool-pane">
    <div class="totp-layout">
      <!-- Bottom: Configuration -->
      <div class="config-side">
        <!-- 1. Secret Input (Tabs) -->
        <div class="config-section">
          <div class="section-header">
            <h3 class="section-title">{{ $t('tools.secret_config') }}</h3>
            <el-button link type="primary" @click="showScanner = true">
              {{ $t('vault.add_scan') }}
            </el-button>
          </div>
          
          <div class="pill-tabs-container">
            <div class="pill-tab" :class="{ active: app_active_tab === 'base32' }" @click="app_active_tab = 'base32'">Base32</div>
            <div class="pill-tab" :class="{ active: app_active_tab === 'hex' }" @click="app_active_tab = 'hex'">{{ $t('tools.totp_hex') }}</div>
            <div class="pill-tab" :class="{ active: app_active_tab === 'ascii' }" @click="app_active_tab = 'ascii'">ASCII</div>
            <div class="pill-tab" :class="{ active: app_active_tab === 'base64' }" @click="app_active_tab = 'base64'">Base64</div>
          </div>
          
          <div class="unified-input-card">
            <el-input 
              v-show="app_active_tab === 'base32'"
              v-model="secretBase32" 
              @input="handleBase32Input" 
              placeholder="JBSWY3DP..." 
              clearable
              type="textarea"
              :rows="3"
              class="seamless-textarea"
            />
            <el-input 
              v-show="app_active_tab === 'hex'"
              v-model="secretHex" 
              @input="handleHexInput" 
              placeholder="48656c6c6f..." 
              clearable
              type="textarea"
              :rows="3"
              class="seamless-textarea"
            />
            <el-input 
              v-show="app_active_tab === 'ascii'"
              v-model="secretAscii" 
              @input="handleAsciiInput" 
              placeholder="Hello..." 
              clearable
              type="textarea"
              :rows="3"
              class="seamless-textarea"
            />
            <el-input 
              v-show="app_active_tab === 'base64'"
              v-model="secretBase64" 
              @input="handleBase64Input" 
              placeholder="SGVsbG8..." 
              clearable
              type="textarea"
              :rows="3"
              class="seamless-textarea"
            />
            
            <div class="inline-input-actions">
              <el-button link type="primary" @click="refreshCurrentSecret"><el-icon><Refresh /></el-icon> {{ $t('tools.regenerate') }}</el-button>
              <el-button link type="primary" @click="copyCurrentSecret"><el-icon><CopyDocument /></el-icon> {{ $t('common.copy') }}</el-button>
            </div>
          </div>
        </div>

        <!-- 2. Metadata -->
        <div class="config-section">
          <h3 class="section-title">{{ $t('tools.basic_info') }}</h3>
          <div class="meta-row">
            <el-input v-model="issuer" @input="updateUri">
              <template #prefix><span class="input-label">{{ $t('vault.service') }}</span></template>
            </el-input>
            <el-input v-model="account" @input="updateUri">
              <template #prefix><span class="input-label">{{ $t('vault.account') }}</span></template>
            </el-input>
          </div>
        </div>

        <!-- 3. Advanced Settings -->
        <div class="config-section advanced-settings">
          <h3 class="section-title">{{ $t('tools.advanced_settings') }}</h3>
          <div class="advanced-row">
            <el-select v-model="algorithm" @change="updateUri" :placeholder="$t('tools.totp_algorithm')" class="flex-1">
              <el-option :label="$t('tools.totp_algo_sha1')" value="SHA-1" />
              <el-option label="SHA-256" value="SHA-256" />
              <el-option label="SHA-512" value="SHA-512" />
              <el-option label="STEAM" value="STEAM" />
            </el-select>
            <el-select v-model="digits" @change="updateUri" :placeholder="$t('tools.totp_digits')" class="w-100" :disabled="algorithm === 'STEAM'">
              <el-option v-if="algorithm === 'STEAM'" :label="$t('vault.digits_5')" :value="5" />
              <el-option :label="$t('vault.digits_6')" :value="6" />
              <el-option :label="$t('vault.digits_8')" :value="8" />
            </el-select>
            <el-select v-model="period" @change="updateUri" :placeholder="$t('tools.totp_period')" class="w-100" :disabled="algorithm === 'STEAM'">
              <el-option :label="$t('vault.period_30s')" :value="30" />
              <el-option :label="$t('vault.period_60s')" :value="60" />
            </el-select>
          </div>
        </div>

        <!-- 4. Result Preview -->
        <div class="config-section">
          <div class="section-header">
            <h3 class="section-title">{{ $t('tools.preview') }}</h3>
            <el-button link type="primary" @click="downloadQrCode" :disabled="!qrCodeUrl">
              <el-icon><Download /></el-icon> {{ $t('common.save') }}
            </el-button>
          </div>
          
          <div class="unified-preview-card">
            <div class="preview-layout-grid">
              <div class="qr-unified-wrapper" v-loading="!qrCodeUrl">
                <img v-if="qrCodeUrl" :src="qrCodeUrl" alt="QR Code" class="qr-img-unified" />
                <el-empty v-else :description="$t('tools.totp_config_preview')" :image-size="80" />
              </div>
              <div class="totp-unified-details">
                <div 
                  class="totp-code-clickable flex flex-items-center gap-10" 
                  @click="currentCode && copyToClipboard(currentCode, $t('common.copy_success'))"
                  :title="$t('common.copy')"
                >
                  <span class="totp-code-giant" :class="{ 'blur': !currentCode }">{{ currentCode || '------' }}</span>
                  <el-icon v-if="currentCode" color="var(--el-color-primary)" size="20"><CopyDocument /></el-icon>
                </div>
                <div class="totp-timer" :class="{ 'urgent': remaining < 5 }" style="margin-left: 10px;">
                  <el-icon><Timer /></el-icon> {{ remaining }}s {{ $t('tools.refresh_after') }}
                </div>
              </div>
            </div>
          </div>

          <div class="uri-box" v-if="qrCodeUrl">
            <div class="uri-text">{{ currentUri }}</div>
            <el-button link type="primary" @click="copyToClipboard(currentUri)"><el-icon><CopyDocument /></el-icon></el-button>
          </div>
        </div>

        <!-- 5. Time Offset -->
        <div class="config-section time-travel-section">
          <div class="section-header">
            <h3 class="section-title mb-0">{{ $t('tools.time_offset') }}</h3>
            <el-button link type="primary" @click="adjustTime(0, true)" size="small">{{ $t('tools.reset_time') }}</el-button>
          </div>
          
          <div class="time-travel-controls">
            <div class="offset-display">
              <span class="offset-label">{{ $t('tools.current_offset') }}</span>
              <span class="offset-value" :class="{ 'has-offset': app_time_offset !== 0 }">
                {{ app_time_offset > 0 ? '+' : '' }}{{ app_time_offset }}s
              </span>
            </div>
            <el-button-group class="segmented-control">
              <el-button @click="adjustTime(-period)" size="default">
                <el-icon class="mr-10"><ArrowLeft /></el-icon> {{ $t('tools.prev_period') }}
              </el-button>
              <el-button @click="adjustTime(period)" size="default">
                {{ $t('tools.next_period') }} <el-icon class="ml-5"><ArrowRight /></el-icon>
              </el-button>
            </el-button-group>
          </div>
        </div>

        <!-- Save Button -->
        <div class="config-section mt-20">
          <el-button type="success" size="large" @click="saveToVault" class="w-full" :loading="isSaving">
            {{ $t('tools.save_to_vault') }}
          </el-button>
        </div>
      </div>
    </div>
    
    <!-- 二维码扫描弹窗 -->
    <el-dialog v-model="showScanner" :title="$t('tools.totp_scan_qr_title')" :width="layoutStore.isMobile ? '90%' : '450px'" destroy-on-close append-to-body>
      <QrScanner @scan-success="handleScanSuccess" />
    </el-dialog>
  </div>
</template>

<script setup>
import { defineAsyncComponent } from 'vue'
import { 
    CopyDocument, Refresh, Timer, Camera, CircleCheck, 
    Download, Operation, ArrowLeft, ArrowRight 
} from '@element-plus/icons-vue'
import { useQueryClient } from '@tanstack/vue-query'
import { copyToClipboard, triggerDownload } from '@/shared/utils/common'
import { useTotpToolbox } from '@/features/tools/composables/useTotpToolbox'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { useTotpToolboxActions } from '@/features/tools/composables/useTotpToolboxActions'

const layoutStore = useLayoutStore()

const QrScanner = defineAsyncComponent(() => import('@/shared/components/qrScanner.vue'))
const queryClient = useQueryClient()

// 1. 获取核心工具箱状态机 (纯运算逻辑与时钟循环)
const toolbox = useTotpToolbox()
const {
    app_active_tab,
    secretBase32, secretHex, secretAscii, secretBase64,
    issuer, account, algorithm, digits, period, app_time_offset,
    currentUri, currentCode, remaining,
    handleBase32Input, handleHexInput, handleAsciiInput, handleBase64Input, updateUri,
    refreshBase32, refreshHex, refreshAscii, refreshBase64,
    adjustTime
} = toolbox

// 2. 获取外部副作用处理器 (QR生成、扫码注入与后端保存)
const {
    isSaving,
    showScanner,
    qrCodeUrl,
    handleScanSuccess,
    saveToVault
} = useTotpToolboxActions(toolbox, queryClient)

const refreshCurrentSecret = () => {
    if (app_active_tab.value === 'base32') refreshBase32()
    else if (app_active_tab.value === 'hex') refreshHex()
    else if (app_active_tab.value === 'ascii') refreshAscii()
    else if (app_active_tab.value === 'base64') refreshBase64()
}

const copyCurrentSecret = () => {
    let text = ''
    if (app_active_tab.value === 'base32') text = secretBase32.value
    else if (app_active_tab.value === 'hex') text = secretHex.value
    else if (app_active_tab.value === 'ascii') text = secretAscii.value
    else if (app_active_tab.value === 'base64') text = secretBase64.value
    
    if (text) copyToClipboard(text)
}

const downloadQrCode = () => {
    if (!qrCodeUrl.value) return
    triggerDownload(qrCodeUrl.value, `nodeauth-qr-${account.value || 'code'}.png`)
}
</script>