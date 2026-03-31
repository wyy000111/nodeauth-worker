<template>
  <div class="data-export-wrapper">
    <div class="tab-card-wrapper">
      <div class="page-header-container">
        <div class="page-header-hero">
          <div class="hero-icon-wrapper">
            <el-icon :size="28"><Download /></el-icon>
          </div>
          <h2 v-if="!layoutStore.isMobile">{{ $t('migration.export') }}</h2>
        </div>
        <p class="page-desc-text">{{ $t('migration.export_desc') }}</p>
      </div>

      <div class="migration-export-groups" v-loading="isExporting" :element-loading-text="loadingText">
        
        <!-- 1. 本系统备份 -->
        <div class="migration-export-group-card">
          <div class="migration-group-header">
            <el-icon><Lock /></el-icon>
            <span>{{ $t('migration.system_backup') }}</span>
          </div>
          <div class="migration-platform-grid">
            <div class="migration-platform-card" @click="openExportDialog('nodeauth_encrypted')">
              <el-icon class="platform-icon icon-system"><Lock /></el-icon>
              <span class="platform-name">{{ $t('migration.system_backup') }}</span>
              <span class="platform-ext">.json ({{ $t('common.encrypted') }})</span>
            </div>
            <div class="migration-platform-card" @click="openWarningDialog('nodeauth_json')">
              <el-icon class="platform-icon icon-system"><Unlock /></el-icon>
              <span class="platform-name">{{ $t('migration.system_backup') }}</span>
              <span class="platform-ext">.json ({{ $t('common.plaintext') }})</span>
            </div>
          </div>
        </div>

        <!-- 2. 移动端 2FA App -->
        <div class="migration-export-group-card">
          <div class="migration-group-header">
            <el-icon><Iphone /></el-icon>
            <span>{{ $t('migration.mobile_app') }}</span>
          </div>
          <div class="migration-platform-grid">
            <div class="migration-platform-card" @click="openWarningDialog('2fas')">
              <el-icon class="platform-icon"><icon2FAS /></el-icon>
              <span class="platform-name">2FAS</span>
              <span class="platform-ext">.2fas</span>
            </div>
            <div class="migration-platform-card" @click="openWarningDialog('aegis')">
              <el-icon class="platform-icon"><iconAegis /></el-icon>
              <span class="platform-name">Aegis</span>
              <span class="platform-ext">.json</span>
            </div>
            <div class="migration-platform-card" @click="openGaDialogDirectly">
              <el-icon class="platform-icon"><iconGoogleAuth /></el-icon>
              <span class="platform-name">Google Auth</span>
              <span class="platform-ext">{{ $t('migration.migrate_ga') }}</span>
            </div>
            <div class="migration-platform-card" @click="openWarningDialog('bitwarden_auth_json')">
              <el-icon class="platform-icon"><iconBitwardenAuth /></el-icon>
              <span class="platform-name">Bitwarden Auth</span>
              <span class="platform-ext">.json</span>
            </div>
          </div>
        </div>

        <!-- 3. 通用格式 -->
        <div class="migration-export-group-card">
          <div class="migration-group-header">
            <el-icon><Document /></el-icon>
            <span>{{ $t('migration.generic_format') }}</span>
          </div>
          <div class="migration-platform-grid">
            <div class="migration-platform-card" @click="openWarningDialog('generic_json')">
              <el-icon class="platform-icon icon-json"><Document /></el-icon>
              <span class="platform-name">{{ $t('migration.generic_format') }}</span>
              <span class="platform-ext">.json</span>
            </div>
            <div class="migration-platform-card" @click="openWarningDialog('generic_text')">
              <el-icon class="platform-icon icon-otpauth"><Tickets /></el-icon>
              <span class="platform-name">OTPAuth URI</span>
              <span class="platform-ext">.txt</span>
            </div>
            <div class="migration-platform-card" @click="openWarningDialog('generic_csv', 'generic')">
              <el-icon class="platform-icon icon-csv"><Grid /></el-icon>
              <span class="platform-name">{{ $t('migration.spreadsheet_csv') }}</span>
              <span class="platform-ext">.csv</span>
            </div>
            <div class="migration-platform-card" @click="openWarningDialog('nodeauth_html')">
              <el-icon class="platform-icon"><Monitor /></el-icon>
              <span class="platform-name">{{ $t('migration.html_page') }}</span>
              <span class="platform-ext">.html</span>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- 加密导出密码弹窗 -->
    <ResponsiveOverlay v-model="showPasswordDialog" :title="$t('migration.export_pwd_title')" width="400px">

      <el-form :model="exportForm" label-position="top">
        <el-form-item :label="$t('migration.export_password')">
          <el-input v-model="exportForm.password" type="password" show-password :placeholder="$t('migration.pwd_placeholder_strong')" />
        </el-form-item>
        <el-form-item :label="$t('migration.export_password_confirm')">
          <el-input v-model="exportForm.confirm" type="password" show-password @keyup.enter="executeExport" :placeholder="$t('migration.pwd_placeholder_again')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showPasswordDialog = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="isExporting" @click="executeExport">{{ $t('migration.start_encrypt_dl') }}</el-button>
      </template>
    </ResponsiveOverlay>

    <!-- 明文导出风险提示弹窗 -->
    <ResponsiveOverlay v-model="showWarningDialog" :title="$t('migration.warning_title')" width="400px">
      <el-alert :title="$t('migration.warning_alert_title')" type="error" :closable="false" :description="$t('migration.warning_desc')" show-icon />
      <template #footer>
        <el-button @click="showWarningDialog = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="danger" @click="executeExport" :loading="isExporting">{{ $t('migration.confirm_export') }}</el-button>
      </template>
    </ResponsiveOverlay>

    <!-- Google Auth 二维码弹窗 -->
    <ResponsiveOverlay v-model="showGaDialog" :title="$t('migration.ga_title')" width="450px" class="text-center">

      <div v-if="gaQrDataUrls.length > 0">
        <p class="mb-10 text-secondary">
          {{ $t('migration.ga_desc_1') }}<br/>
          <span v-if="gaQrDataUrls.length > 1" class="font-bold" style="color: var(--el-color-warning);">
            {{ $t('migration.ga_desc_multiple') }}
          </span>
        </p>
        <div v-loading="isExporting" class="min-h-200 flex-column flex-center">
          <img :src="gaQrDataUrls[gaCurrentIndex]" alt="Google Auth Migration QR" class="max-w-100p p-10 mb-15" />
          
          <div v-if="gaQrDataUrls.length > 1" class="flex-center gap-15">
            <el-button :disabled="gaCurrentIndex === 0" @click="gaCurrentIndex--" size="small">{{ $t('migration.btn_prev') }}</el-button>
            <span class="font-bold" style="font-size: 14px;">{{ gaCurrentIndex + 1 }} / {{ gaQrDataUrls.length }}</span>
            <el-button :disabled="gaCurrentIndex === gaQrDataUrls.length - 1" @click="gaCurrentIndex++" size="small" type="primary">{{ $t('migration.btn_next') }}</el-button>
          </div>
        </div>
      </div>
      <div v-else v-loading="isExporting" class="min-h-200"></div>
      <template #footer>
        <el-button @click="showGaDialog = false">{{ $t('migration.finish') }}</el-button>
      </template>
    </ResponsiveOverlay>

    <!-- 账号选择弹窗 (用于 Google Auth 选择性导出) -->
    <ResponsiveOverlay v-model="showAccountSelectDialog" :title="$t('migration.select_account_title')" width="500px">

      <div class="migration-account-select-toolbar">
        <el-input 
          v-model="searchKeyword" 
          :placeholder="$t('migration.search_account')" 
          clearable 
          :prefix-icon="Search"
          style="margin-bottom: 15px;"
        />
        <div class="migration-toolbar-actions">
          <el-checkbox 
            v-model="isAllSelected" 
            :indeterminate="isIndeterminate"
            @change="toggleSelectAll"
          >
            {{ selectAllText }}
          </el-checkbox>
          <span class="migration-selected-count">{{ $t('migration.selected_count', { selected: selectedAccountIds.length, total: fullVault.length }) }}</span>
        </div>
      </div>
      
      <div class="migration-account-list-container">
        <el-checkbox-group v-model="selectedAccountIds">
          <template v-if="filteredVault.length > 0">
            <div v-for="acc in filteredVault" :key="acc.id" class="migration-account-item">
              <el-checkbox :label="acc.id" size="large">
                <div class="migration-account-item-content">
                  <span class="service-name text-15 font-600 text-primary">{{ acc.service || 'Unknown Service' }}</span>
                  <span v-if="acc.account" class="account-name text-13 text-regular">{{ acc.account }}</span>
                </div>
              </el-checkbox>
            </div>
          </template>
          <el-empty v-else :description="$t('migration.no_matching')" :image-size="60" />
        </el-checkbox-group>
      </div>
      
      <template #footer>
        <el-button @click="showAccountSelectDialog = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="isExporting" @click="executeGaExport">{{ $t('migration.migrate_btn', { count: selectedAccountIds.length }) }}</el-button>
      </template>
    </ResponsiveOverlay>

  </div>
</template>


<script setup>
import { computed } from 'vue'
import { 
  Lock, Iphone, Document, Search, 
  Unlock, Tickets, Grid, Monitor, Download
} from '@element-plus/icons-vue'
import icon2FAS from '@/shared/components/icons/icon2FAS.vue'
import iconAegis from '@/shared/components/icons/iconAegis.vue'
import iconGoogleAuth from '@/shared/components/icons/iconGoogleAuth.vue'
import iconBitwardenAuth from '@/shared/components/icons/iconBitwardenAuth.vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { useDataExport } from '@/features/migration/composables/useDataExport'
import ResponsiveOverlay from '@/shared/components/responsiveOverlay.vue'
import { i18n } from '@/locales'



const layoutStore = useLayoutStore()

const {
  showPasswordDialog,
  showWarningDialog,
  showAccountSelectDialog,
  showGaDialog,
  isExporting,
  exportForm,
  loadingText,
  gaQrDataUrls,
  gaCurrentIndex,
  
  fullVault,
  searchKeyword,
  selectedAccountIds,
  filteredVault,
  
  openExportDialog,
  openWarningDialog,
  openGaDialogDirectly,
  executeExport,
  executeGaExport,
  toggleSelectAll
} = useDataExport()

// 动态计算“全选”按钮文案
const selectAllText = computed(() => {
  const { t } = i18n.global
  if (!searchKeyword.value || searchKeyword.value.trim() === '') {
    return t('migration.select_all_accounts')
  } else {
    return t('migration.select_all_search', { count: filteredVault.value.length })
  }
})

// 计算当前过滤列表的全选状态
const isAllSelected = computed({
  get: () => {
    if (filteredVault.value.length === 0) return false
    return filteredVault.value.every(acc => selectedAccountIds.value.includes(acc.id))
  },
  set: (val) => {
    // 触发由 toggleSelectAll 在 handle change 时处理
  }
})

// 半选状态
const isIndeterminate = computed(() => {
  const selectedInFilter = filteredVault.value.filter(acc => selectedAccountIds.value.includes(acc.id)).length
  return selectedInFilter > 0 && selectedInFilter < filteredVault.value.length
})
</script>

