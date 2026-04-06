<template>
  <div class="add-vault-wrapper">
    <div class="tab-card-wrapper">
      <div class="page-header-container">
        <div class="page-header-hero">
          <div class="hero-icon-wrapper">
            <el-icon :size="28"><Plus /></el-icon>
          </div>
          <h2 v-if="!layoutStore.isMobile">{{ $t('menu.add') }}</h2>
        </div>
        <p class="page-desc-text">{{ $t('vault.add_account_tip') }}</p>
      </div>
      
      <div class="flex-center mb-20">
        <el-radio-group v-model="activeMode" class="mode-switcher-radio">
          <el-radio-button v-for="opt in modeOptions" :key="opt.value" :label="opt.value">
            <div class="flex-center gap-5">
              <el-icon><component :is="opt.icon" /></el-icon>
              <span>{{ opt.label }}</span>
            </div>
          </el-radio-button>
        </el-radio-group>
      </div>

      <div class="max-w-600 m-auto">
        <!-- 摄像头 / 图片识别 -->
        <div v-if="activeMode === 'camera' || activeMode === 'image'">
          <QrScanner 
            :force-mode="activeMode"
            @scan-success="handleScanSuccess" 
          />
        </div>

        <!-- 手动输入 -->
        <div v-else-if="activeMode === 'manual'" class="vault-manual-form-container">
          <div class="m-auto w-full">
            <el-form :model="newVault" label-position="top" :rules="rules" ref="addFormRef" class="vault-manual-form-wrapper">
              <el-form-item :label="$t('vault.service_name')" prop="service">
                <el-input v-model="newVault.service" :placeholder="$t('vault.input_service_placeholder')" />
              </el-form-item>
              <el-form-item :label="$t('vault.account_identifier')" prop="account">
                <el-input v-model="newVault.account" :placeholder="$t('vault.input_account_placeholder')" />
              </el-form-item>
              <el-form-item :label="$t('vault.input_secret_label')" prop="secret">
                <el-input v-model="newVault.secret" :placeholder="$t('vault.input_secret_placeholder')" clearable>
                  <template #append>
                    <el-button @click="generateRandomSecret" :title="$t('vault.generate_random_secret')"><el-icon><Refresh /></el-icon></el-button>
                  </template>
                </el-input>
              </el-form-item>
              <el-row :gutter="20">
                <el-col :span="8">
                  <el-form-item :label="$t('vault.algorithm_label')" prop="algorithm">
                    <el-select v-model="newVault.algorithm" class="w-full">
                      <el-option :label="$t('vault.algo_sha1')" value="SHA1" />
                      <el-option label="SHA256" value="SHA256" />
                      <el-option label="SHA512" value="SHA512" />
                      <el-option :label="$t('vault.algo_steam')" value="STEAM" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item :label="$t('vault.digits_label')" prop="digits">
                    <el-select v-model="newVault.digits" class="w-full" :disabled="newVault.algorithm === 'STEAM'">
                      <el-option v-if="newVault.algorithm === 'STEAM'" :label="$t('vault.digits_5')" :value="5" />
                      <el-option :label="$t('vault.digits_6')" :value="6" />
                      <el-option :label="$t('vault.digits_8')" :value="8" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item :label="$t('vault.period_label')" prop="period">
                    <el-select v-model="newVault.period" class="w-full" :disabled="newVault.algorithm === 'STEAM'">
                      <el-option :label="$t('vault.period_30s')" :value="30" />
                      <el-option :label="$t('vault.period_60s')" :value="60" />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>
              <el-form-item :label="$t('vault.category_optional')" prop="category">
                <el-input v-model="newVault.category" :placeholder="$t('vault.input_category_placeholder')" />
              </el-form-item>
              <el-form-item class="mt-30">
                <el-button type="primary" :loading="submitting" @click="submitAddVault" class="vault-manual-submit-btn" size="large">{{ $t('vault.confirm_add_btn') }}</el-button>
              </el-form-item>
            </el-form>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, h, defineAsyncComponent, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Camera, Picture, Edit, Refresh, Plus } from '@element-plus/icons-vue'
import { parseOtpUri, bytesToBase32 } from '@/shared/utils/totp'
import { useVaultStore } from '@/features/vault/store/vaultStore'
import { vaultService } from '@/features/vault/service/vaultService'
import { i18n } from '@/locales'
import { useLayoutStore } from '@/features/home/store/layoutStore'

const QrScanner = defineAsyncComponent(() => import('@/shared/components/qrScanner.vue'))

const emit = defineEmits(['success'])
const vaultStore = useVaultStore()
const layoutStore = useLayoutStore()
const { t } = i18n.global

const activeMode = ref('camera')

const modeOptions = computed(() => [
  { label: t('vault.add_mode_camera'), value: 'camera', icon: Camera },
  { label: t('vault.add_mode_image'), value: 'image', icon: Picture },
  { label: t('vault.add_account'), value: 'manual', icon: Edit }
])

// --- Manual Add Logic ---
const submitting = ref(false)
const addFormRef = ref(null)
const newVault = ref({
  service: '', account: '', secret: '', category: '', digits: 6, period: 30, algorithm: 'SHA1'
})

const validateSecret = (rule, value, callback) => {
  if (!value) {
    return callback(new Error(t('vault.require_secret')))
  }
  const clean = value.replace(/\s/g, '')
  if (clean.length < 16) {
    return callback(new Error(t('vault.secret_min_length')))
  }
  if (!/^[A-Z2-7]+$/i.test(clean)) {
    return callback(new Error(t('vault.secret_invalid_char')))
  }
  callback()
}

const rules = {
  service: [{ required: true, message: t('vault.require_service'), trigger: 'blur' }],
  account: [{ required: true, message: t('vault.require_account'), trigger: 'blur' }],
  secret: [{ required: true, validator: validateSecret, trigger: 'blur' }]
}

// 监听算法变化，针对 Steam 令牌进行自动联动
watch(() => newVault.value.algorithm, (newAlgo) => {
  if (newAlgo === 'STEAM') {
    newVault.value.digits = 5
    newVault.value.period = 30
    if (!newVault.value.service) {
      newVault.value.service = 'Steam'
    }
  } else if (newVault.value.digits === 5) {
    // 切回普通算法时，重置为标准的 6 位
    newVault.value.digits = 6
    if (newVault.value.service === 'Steam') {
      newVault.value.service = ''
    }
  }
})

const generateRandomSecret = () => {
  const array = new Uint8Array(20)
  window.crypto.getRandomValues(array)
  newVault.value.secret = bytesToBase32(array)
}

const submitAddVault = async () => {
  if (!addFormRef.value) return
  await addFormRef.value.validate(async (valid) => {
    if (valid) {
      submitting.value = true
      try {
        const data = await vaultService.createAccount(newVault.value)
        if (data.success) {
          // 💡 实时补偿：增加服务器标称总量
          if (!layoutStore.isOffline) {
            await vaultStore.updateMetadata({ delta: 1 })
          }

          ElMessage.success(t('vault.add_success'))
          newVault.value = { service: '', account: '', secret: '', category: '', digits: 6, period: 30, algorithm: 'SHA1' }
          vaultStore.markDirty()
          emit('success')
        }
      } catch (error) {
      } finally {
        submitting.value = false
      }
    }
  })
}

// --- Scan Logic ---
const handleScanSuccess = async (uri) => {
  try {
    const acc = parseOtpUri(uri)
    if (!acc) {
      ElMessage.error(t('vault.invalid_qr_format'))
      return
    }

    await ElMessageBox.confirm(
      h('div', { class: 'confirmation-box' }, [
        h('div', { class: 'confirmation-row' }, [
           h('span', { class: 'confirmation-label' }, t('vault.service_label')),
           h('span', { class: 'confirmation-value' }, acc.service || t('vault.unknown_service'))
        ]),
        h('div', { class: 'confirmation-row' }, [
           h('span', { class: 'confirmation-label' }, t('vault.account_label')),
           h('span', { class: 'confirmation-value mono' }, acc.account || t('vault.unnamed_account'))
        ]),
        h('div', { class: 'confirmation-row' }, [
           h('span', { class: 'confirmation-label' }, t('vault.param_label')),
           h('div', { class: 'confirmation-tags' }, [
               h('span', { class: 'confirmation-tag confirmation-tag-info' }, acc.algorithm || 'SHA1'),
               h('span', { class: 'confirmation-tag confirmation-tag-success' }, `${acc.digits || 6}${t('vault.digits_suffix')}`),
               h('span', { class: 'confirmation-tag confirmation-tag-warning' }, `${acc.period || 30}${t('vault.period_suffix')}`)
           ])
        ])
      ]),
      t('vault.confirm_add_title'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'success',
        center: true
      }
    )

    const addData = await vaultService.addFromUri(uri, 'Scan')

    if (addData.success) {
      // � 物理落盘

      // �💡 实时补偿
      if (!layoutStore.isOffline) {
        await vaultStore.updateMetadata({ delta: 1 })
      }
      ElMessage.success(t('vault.add_success'))
      vaultStore.markDirty()
      emit('success')
    }
  } catch (err) {
    if (err !== 'cancel') console.error(err)
  }
}
</script>

<style scoped>
.mode-switcher-radio {
  display: flex;
  justify-content: center;
}

:deep(.el-radio-button__inner) {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
}
</style>
