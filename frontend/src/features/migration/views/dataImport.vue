<template>
  <div class="data-import-wrapper">
    <div class="tab-card-wrapper">
      <div class="page-header-container">
        <div class="page-header-hero">
          <div class="hero-icon-wrapper">
            <el-icon :size="28"><Upload /></el-icon>
          </div>
          <h2 v-if="!layoutStore.isMobile">{{ $t('migration.center_title') }}</h2>
        </div>
        <p class="page-desc-text">{{ $t('migration.import_desc') }}</p>
      </div>

      <div class="max-w-100p m-auto">
        
        <!-- 统一的拖拽上传区域 -->
        <el-upload
          ref="uploadRef"
          class="migration-import-upload"
          drag
          action="#"
          multiple
          :auto-upload="false"
          :show-file-list="false"
          :on-change="handleFileUpload"
        >
          <el-icon class="el-icon--upload"><upload-filled /></el-icon>
          <div class="el-upload__text">
            <p><el-tag type="success" effect="light">{{ $t('migration.auto_identify_tip') }}</el-tag></p>
            <p><span v-html="$t('migration.drag_drop_tip')"></span></p>
          </div>
        </el-upload>

        <!-- 支持情况说明 (直接展示版) -->
        <div class="migration-ecosystem mt-30">
          <el-divider border-style="dashed">
            <span class="text-secondary font-12 flex-center gap-5">
              <el-icon><QuestionFilled /></el-icon>
              {{ $t('migration.support_desc') }}
            </span>
          </el-divider>

          <div class="compatibility-container mt-20 mb-10">
            <div class="ecosystem-groups">
              <!-- 组1: 本系统 -->
              <div class="ecosystem-group-card">
                <h4 class="group-title">
                  <el-icon><Folder /></el-icon>
                  {{ $t('migration.system_backup_format') }}
                </h4>
                <div class="migration-platform-grid">
                  <div class="migration-platform-card" @click="triggerUpload">
                    <el-icon class="platform-icon icon-system"><Lock /></el-icon>
                    <span class="platform-name">{{ $t('migration.system_backup') }}</span>
                    <span class="platform-ext">.json ({{ $t('common.encrypted') }})</span>
                  </div>
                  <div class="migration-platform-card" @click="triggerUpload">
                    <el-icon class="platform-icon icon-system"><Unlock /></el-icon>
                    <span class="platform-name">{{ $t('migration.system_backup') }}</span>
                    <span class="platform-ext">.json ({{ $t('common.plaintext') }})</span>
                  </div>
                </div>
              </div>

              <!-- 组2: 密码管理器 -->
              <div class="ecosystem-group-card">
                <h4 class="group-title">
                  <el-icon><Monitor /></el-icon>
                  {{ $t('migration.password_manager_format') }}
                </h4>
                <div class="migration-platform-grid">
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconBitwardenPass /></el-icon> <span class="platform-name">Bitwarden</span> <span class="platform-ext">.json / .csv</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><icon1Password /></el-icon> <span class="platform-name">1Password</span> <span class="platform-ext">.1pux / .csv</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconProtonPass /></el-icon> <span class="platform-name">Proton Pass</span> <span class="platform-ext">.pgp / .csv</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconKeeper /></el-icon> <span class="platform-name">Keeper</span> <span class="platform-ext">.csv</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconNordPass /></el-icon> <span class="platform-name">NordPass</span> <span class="platform-ext">.csv</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconEnpass /></el-icon> <span class="platform-name">Enpass</span> <span class="platform-ext">.csv</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconRoboForm /></el-icon> <span class="platform-name">Roboform</span> <span class="platform-ext">.csv</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconKeePass /></el-icon> <span class="platform-name">KeePassXC</span> <span class="platform-ext">.csv</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconApple /></el-icon> <span class="platform-name">iCloud Keychain</span> <span class="platform-ext">.csv</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconDashlanePass /></el-icon> <span class="platform-name">Dashlane</span> <span class="platform-ext">.csv</span></div>
                </div>
              </div>

              <!-- 组3: 移动端 2FA App -->
              <div class="ecosystem-group-card">
                <h4 class="group-title">
                  <el-icon><Iphone /></el-icon>
                  {{ $t('migration.mobile_app_format') }}
                </h4>
                <div class="migration-platform-grid">
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><icon2FAS /></el-icon> <span class="platform-name">2FAS</span> <span class="platform-ext">.2fas</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconAegis /></el-icon> <span class="platform-name">Aegis</span> <span class="platform-ext">.json / .txt</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconBitwardenAuth /></el-icon> <span class="platform-name">Bitwarden Auth</span> <span class="platform-ext">.json / .csv</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconGoogleAuth /></el-icon> <span class="platform-name">Google Auth</span> <span class="platform-ext">.png / .jpg</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconProtonAuth /></el-icon> <span class="platform-name">Proton Auth</span> <span class="platform-ext">.json</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconEnte /></el-icon> <span class="platform-name">Ente Auth</span> <span class="platform-ext">.txt</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconMicrosoftAuth /></el-icon> <span class="platform-name">Microsoft Auth</span> <span class="platform-ext">PhoneFactor</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon"><iconLastPassAuth /></el-icon> <span class="platform-name">LastPass Auth</span> <span class="platform-ext">.json</span></div>
                </div>
              </div>

              <!-- 组3: 通用格式 -->
              <div class="ecosystem-group-card">
                <h4 class="group-title">
                  <el-icon><Document /></el-icon>
                  {{ $t('migration.generic_format') }}
                </h4>
                <div class="migration-platform-grid">
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon icon-json"><Document /></el-icon> <span class="platform-name">{{ $t('migration.generic_json') }}</span> <span class="platform-ext">.json</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon icon-otpauth"><Tickets /></el-icon> <span class="platform-name">OTPAuth URI</span> <span class="platform-ext">.txt</span></div>
                  <div class="migration-platform-card" @click="triggerUpload"><el-icon class="platform-icon icon-csv"><Grid /></el-icon> <span class="platform-name">{{ $t('migration.spreadsheet_csv') }}</span> <span class="platform-ext">.csv</span></div>
                </div>
              </div>

              <!-- 组4: Steam 令牌 -->
              <div class="ecosystem-group-card">
                <h4 class="group-title">
                  <el-icon class="icon-steam"><iconSteam /></el-icon>
                  {{ $t('migration.steam_guard_title') }}
                </h4>
                <div class="migration-platform-grid">
                  <div class="migration-platform-card" @click="triggerUpload">
                    <el-icon class="platform-icon icon-steam"><iconSteam /></el-icon>
                    <span class="platform-name">{{ $t('migration.steam_guard_title') }}</span>
                    <span class="platform-ext">.maFile / .txt</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 详细引导 -->
            <el-divider border-style="dashed" content-position="center" class="mt-30">
              <span class="text-secondary font-12">{{ $t('migration.import_guide') }}</span>
            </el-divider>

            <div class="guide-section">
              <div class="migration-ga-tip">
                <span><el-icon><iconGoogleAuth /></el-icon> Google Authenticator</span>
                <p>{{ $t('migration.ga_auth_desc') }}</p>
              </div>
              <div class="migration-ms-tip">
                <span><el-icon><iconMicrosoftAuth /></el-icon> {{ $t('migration.ms_auth_desc') }}</span>
                <p>{{ $t('migration.ms_auth_detail') }}</p>
                <div class="code-block-wrapper">
                  <code>/data/data/com.azure.authenticator/databases/PhoneFactor</code>
                  <code>/data/data/com.azure.authenticator/databases/PhoneFactor-wal</code>
                  <code>/data/data/com.azure.authenticator/databases/PhoneFactor-shm</code>
                </div>
              </div>
              <div class="migration-steam-tip">
                <span><el-icon><iconSteam /></el-icon> {{ $t('migration.steam_guard_title') }}</span>
                <p v-html="$t('migration.steam_guard_desc_guide')"></p>
                <div class="steam-example-list">
                    <code>.maFile Steam Desktop Authenticator (SDA)</code>
                    <code>steam://ABCDE12345FGHIJKLMNOPQRSTUV</code>
                    <code>otpauth://totp/Steam:account?secret=ABCDE12345...</code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 批量导入进度弹窗 -->
    <ResponsiveOverlay
      v-model="showBatchProgress"
      :title="$t('migration.batch_import_processing')"
      width="450px"
      :close-on-click-modal="false"
      :show-close="false"
    >



      <div class="text-center py-10">
        <el-progress 
          type="dashboard" 
          :percentage="batchProgressPercent" 
          :status="batchProgressPercent === 100 ? 'success' : ''" 
        />
        <h3 class="mt-20">
          {{ $t('migration.batch_progress', { processed: batchProcessedJobs, total: batchTotalJobs }) }}
        </h3>
        <p class="text-secondary mt-10">
          {{ batchCurrentTaskName }}
        </p>
      </div>
    </ResponsiveOverlay>

    <!-- 加密文件密码输入弹窗 -->
    <ResponsiveOverlay v-model="showDecryptDialog" :title="$t('migration.decrypt_backup_title')" width="400px" @close="handleDecryptDialogClose">



      <el-alert v-if="currentImportType === 'aegis_encrypted'" :title="$t('migration.detect_aegis')" type="warning" :closable="false" class="mb-15" />
      <el-alert v-else-if="currentImportType === 'proton_auth_encrypted'" :title="$t('migration.detect_proton_auth')" type="warning" :closable="false" class="mb-15" />
      <el-alert v-else-if="currentImportType === 'proton_pass_pgp'" :title="$t('migration.detect_proton_pass')" type="warning" :closable="false" class="mb-15" />
      <el-alert v-else-if="currentImportType === '2fas_encrypted'" :title="$t('migration.detect_2fas')" type="warning" :closable="false" class="mb-15" />
      <el-alert v-else-if="currentImportType === 'ente_encrypted'" :title="$t('migration.detect_ente')" type="warning" :closable="false" class="mb-15" />
      <el-alert v-else-if="currentImportType === 'bitwarden_pass_encrypted'" :title="$t('migration.detect_bitwarden_pass')" type="warning" :closable="false" class="mb-15" />
      <el-alert v-else-if="currentImportType === 'steam_mafile'" :title="$t('migration.detect_steam_mafile')" type="success" :closable="false" class="mb-15" />
      <el-alert v-else :title="$t('migration.detect_system')" type="success" :closable="false" class="mb-15" />
      <el-form label-position="top">
        <el-form-item :label="$t('migration.input_decrypt_pwd_label')">
          <el-input v-model="importPassword" type="password" show-password @keyup.enter="submitEncryptedData" :placeholder="$t('migration.input_decrypt_pwd_placeholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDecryptDialog = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="isDecrypting" @click="submitEncryptedData">{{ $t('migration.confirm_decrypt_import') }}</el-button>
      </template>
    </ResponsiveOverlay>


  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Upload, UploadFilled, Lock, Unlock, Document, Tickets, Grid, Warning, Folder, Iphone, QuestionFilled, Monitor } from '@element-plus/icons-vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { useDataImport } from '@/features/migration/composables/useDataImport'
import ResponsiveOverlay from '@/shared/components/responsiveOverlay.vue'



const layoutStore = useLayoutStore()
const uploadRef = ref(null)

const triggerUpload = () => {
  // Use the nested input element inside el-upload component to trigger the file picker
  uploadRef.value?.$el.querySelector('input')?.click()
}

// icons for import options (follow export page style)
import icon2FAS from '@/shared/components/icons/icon2FAS.vue'
import iconAegis from '@/shared/components/icons/iconAegis.vue'
import iconGoogleAuth from '@/shared/components/icons/iconGoogleAuth.vue'
import iconBitwardenPass from '@/shared/components/icons/iconBitwardenPass.vue'
import iconBitwardenAuth from '@/shared/components/icons/iconBitwardenAuth.vue'
import iconMicrosoftAuth from '@/shared/components/icons/iconMicrosoftAuth.vue'
import iconDashlanePass from '@/shared/components/icons/iconDashlanePass.vue'
import iconProtonAuth from '@/shared/components/icons/iconProtonAuth.vue'
import iconProtonPass from '@/shared/components/icons/iconProtonPass.vue'
import iconEnte from '@/shared/components/icons/iconEnte.vue'
import icon1Password from '@/shared/components/icons/icon1Password.vue'
import iconLastPassAuth from '@/shared/components/icons/iconLastPassAuth.vue'
import iconKeeper from '@/shared/components/icons/iconKeeper.vue'
import iconNordPass from '@/shared/components/icons/iconNordPass.vue'
import iconRoboForm from '@/shared/components/icons/iconRoboForm.vue'
import iconEnpass from '@/shared/components/icons/iconEnpass.vue'
import iconKeePass from '@/shared/components/icons/iconKeePass.vue'
import iconApple from '@/shared/components/icons/iconApple.vue'
import iconSteam from '@/shared/components/icons/iconSteam.vue'

const emit = defineEmits(['success'])

const {
  currentImportType,
  showDecryptDialog,
  importPassword,
  isDecrypting,
  showBatchProgress,
  batchCurrentTaskName,
  batchProcessedJobs,
  batchTotalJobs,
  batchProgressPercent,
  handleFileUpload,
  submitEncryptedData,
  handleDecryptDialogClose
} = useDataImport(emit)

</script>


