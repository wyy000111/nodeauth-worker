<template>
  <div class="settings-security-wrapper">
    <div class="tab-card-wrapper">
      <div class="page-header-container">
        <div class="page-header-hero">
          <div class="hero-icon-wrapper">
            <el-icon :size="28"><Lock /></el-icon>
          </div>
          <h2 v-if="!layoutStore.isMobile">{{ $t('menu.security') }}</h2>
        </div>
        <p class="page-desc-text">{{ $t('security.title') }}</p>
      </div>

      <div class="security-grid">
        <el-card shadow="hover" class="setting-item-card clickable-card" @click="layoutStore.setActiveTab('settings-devices')">
          <div class="setting-item-content">
            <div class="setting-item-left">
              <el-icon><Monitor /></el-icon>
              <div class="setting-item-info">
                <span class="setting-title">{{ $t('security.devices') }}</span>
                <span class="setting-desc">{{ $t('security.devices_desc') }}</span>
              </div>
            </div>
            <el-icon class="card-arrow"><ArrowRight /></el-icon>
          </div>
        </el-card>

        <!-- 6位 PIN 码安全锁 (币圈标准) -->
        <el-card shadow="hover" class="setting-item-card">
          <div class="setting-item-content">
            <div class="setting-item-left">
              <el-icon><IconPinCode /></el-icon>
              <div class="setting-item-info">
                <span class="setting-title">{{ $t('security.pin_lock') }}</span>
                <span class="setting-desc">{{ $t('security.pin_lock_desc') }}</span>
              </div>
            </div>
            <div class="setting-item-right">
               <el-tag v-if="appLockStore.lockMode !== 'none'" type="success" size="small">{{ $t('security.locked_active') }}</el-tag>
               <el-button v-if="appLockStore.lockMode === 'none'" type="primary" size="small" @click="handleSetupPin">
                 {{ $t('common.setup') }}
               </el-button>
               <el-button v-else type="danger" size="small" plain @click="handleDisableLock">
                 {{ $t('common.disable') }}
               </el-button>
            </div>
          </div>
        </el-card>

        <!-- 生物识别快捷解锁 (FaceID/Fingerprint) -->
        <el-card v-if="appLockStore.lockMode !== 'none'" shadow="hover" class="setting-item-card">
          <div class="setting-item-content">
            <div class="setting-item-left">
              <el-icon><IconFaceID /></el-icon>
              <div class="setting-item-info">
                <span class="setting-title">{{ $t('security.biometric_unlock') }}</span>
                <span class="setting-desc" :class="{ 'text-warning': !appLockStore.isBiometricAvailable }">
                    {{ appLockStore.isBiometricAvailable ? $t('security.biometric_unlock_desc') : $t('security.biometric_prf_unsupported') }}
                </span>

              </div>
            </div>
            <el-switch 
                :model-value="['biometric', 'biometric_compat'].includes(appLockStore.lockMode)" 
                :disabled="!appLockStore.isBiometricAvailable"

                @change="handleBiometricToggle" 
            />
          </div>

        </el-card>

        <!-- 自动锁定延迟 -->
        <el-card v-if="appLockStore.lockMode !== 'none'" shadow="hover" class="setting-item-card">
          <div class="setting-item-content">
            <div class="setting-item-left">
              <el-icon><Timer /></el-icon>
              <div class="setting-item-info">
                <span class="setting-title">{{ $t('security.auto_lock_delay') }}</span>
                <span class="setting-desc">{{ $t('security.auto_lock_delay_desc') }}</span>
              </div>
            </div>
            <div class="setting-item-right">
              <el-select 
                :model-value="appLockStore.autoLockDelay" 
                @update:model-value="appLockStore.setAutoLockDelay"
                size="small" 
                style="width: 110px"
              >
                <el-option :label="$t('security.delay_0s')" :value="0" />
                <el-option :label="$t('security.delay_30s')" :value="30" />
                <el-option :label="$t('security.delay_1m')" :value="60" />
                <el-option :label="$t('security.delay_5m')" :value="300" />
                <el-option :label="$t('security.delay_10m')" :value="600" />
              </el-select>
            </div>
          </div>
        </el-card>

        <el-card shadow="hover" class="setting-item-card">
          <div class="setting-item-content">
            <div class="setting-item-left">
              <el-icon><View /></el-icon>
              <div class="setting-item-info">
                <span class="setting-title">{{ $t('security.ghost_mode') }}</span>
                <span class="setting-desc">{{ $t('security.ghost_mode_desc') }}</span>
              </div>
            </div>
            <el-switch :model-value="layoutStore.appGhostMode" @change="layoutStore.setGhostMode" />
          </div>
        </el-card>

        <!-- 离线模式 -->
        <el-card shadow="hover" class="setting-item-card">
          <div class="setting-item-content">
            <div class="setting-item-left">
              <el-icon><Connection /></el-icon>
              <div class="setting-item-info">
                <span class="setting-title">{{ $t('security.offline_mode') }}</span>
                <span class="setting-desc">{{ $t('security.offline_mode_desc') }}</span>
              </div>
            </div>
            <el-switch :model-value="layoutStore.isManualOffline" @change="handleOfflineToggle" />
          </div>
        </el-card>
      </div>


      <!-- 🛡️ 安全锁设置对话框 (响应式) -->
      <ResponsiveOverlay
        v-model="showPinSetup"
        :title="$t('security.setup_pin_title')"
        width="400px"
        :destroy-on-close="false"
        :append-to-body="!layoutStore.isMobile"
        :trap-focus="!layoutStore.isMobile"
        :class="{ 'no-motion': layoutStore.isMobile }"
        @opened="handleSetupOpened"
      >
        <div class="pin-setup-container" style="padding: 10px 0; text-align: center;">
          <p class="text-secondary mb-20">{{ $t('security.setup_pin_tip') }}</p>
          <div class="flex-column-center gap-20">
            <el-input 
              ref="newPinInput"
              v-model="newPin" 
              type="password" 
              maxlength="6" 
              show-password 
              placeholder="000000"
              class="pin-input-centered"
              style="width: 100%; max-width: 260px; font-size: 24px; letter-spacing: 4px;"
              @input="newPin = newPin.replace(/\D/g, '')"
              inputmode="numeric"
            />
            
            <div class="drawer-actions" style="margin-top: 20px; display: flex; gap: 10px; width: 100%;">
                <el-button @click="showPinSetup = false" style="flex: 1">{{ $t('common.cancel') }}</el-button>
                <el-button type="primary" :disabled="newPin.length !== 6" @click="confirmPinSetup" style="flex: 1">
                    {{ $t('common.confirm') }}
                </el-button>
            </div>
          </div>
        </div>
      </ResponsiveOverlay>

      <!-- 🛡️ 停用安全锁专用对话框 (响应式) -->
      <ResponsiveOverlay
        v-model="showPinDisable"
        :title="$t('security.disable_pin_title')"
        width="400px"
        :destroy-on-close="false"
        :append-to-body="!layoutStore.isMobile"
        :trap-focus="!layoutStore.isMobile"
        :class="{ 'no-motion': layoutStore.isMobile }"
        @opened="handleDisableOpened"
      >
        <div class="pin-setup-container" style="padding: 10px 0; text-align: center;">
          <p class="text-secondary mb-20">{{ $t('security.disable_pin_tip') }}</p>
          <div class="flex-column-center gap-20">
            <el-input 
              ref="disablePinInput"
              v-model="disablePin" 
              type="password" 
              maxlength="6" 
              show-password 
              placeholder="••••••"
              class="pin-input-centered"
              style="width: 100%; max-width: 260px; font-size: 24px; letter-spacing: 4px;"
              @input="disablePin = disablePin.replace(/\D/g, '')"
              inputmode="numeric"
            />
            
            <div class="drawer-actions" style="margin-top: 20px; display: flex; gap: 10px; width: 100%;">
                <el-button @click="showPinDisable = false" style="flex: 1">{{ $t('common.cancel') }}</el-button>
                <el-button type="danger" :disabled="disablePin.length !== 6" @click="confirmDisable" style="flex: 1">
                    {{ $t('security.confirm_disable') }}
                </el-button>
            </div>
          </div>
        </div>
      </ResponsiveOverlay>

      <!-- 2. 离线就绪准备度检测弹窗 -->
      <OfflineReadinessDialog 
        v-model="showReadinessDialog"
        @confirm="() => layoutStore.setOfflineMode(true)"
      />

      <!-- 🛡️ 软键盘曼哈顿计划：隐藏占位符用于在移动端由于异步弹窗导致手势断裂时，同步唤起键盘 -->
      <input 
        ref="keyboardBridge"
        type="password"
        inputmode="numeric"
        style="position: absolute; opacity: 0; pointer-events: none; top: -100px; left: -100px; height: 1px; width: 1px;"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { useAppLockStore } from '@/features/applock/store/appLockStore'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { Lock, View, Monitor, ArrowRight, Connection, Timer, Close } from '@element-plus/icons-vue'
import IconFaceID from '@/shared/components/icons/iconFaceID.vue'
import IconPinCode from '@/shared/components/icons/iconPinCode.vue'

import { ElMessage, ElMessageBox } from 'element-plus'
import OfflineReadinessDialog from '../components/offlineReadinessDialog.vue'

import ResponsiveOverlay from '@/shared/components/responsiveOverlay.vue'



const layoutStore = useLayoutStore()
const appLockStore = useAppLockStore()
const authStore = useAuthUserStore()
const router = useRouter()
const { t } = useI18n()


const showReadinessDialog = ref(false)
const showPinSetup = ref(false)
const showPinDisable = ref(false)
const newPin = ref('')
const disablePin = ref('')

const newPinInput = ref(null)
const disablePinInput = ref(null)
const keyboardBridge = ref(null)

// 专门处理弹窗打开后的精准聚焦，确保移动端键盘弹出
const handleSetupOpened = () => {
    nextTick(() => {
        const input = newPinInput.value?.$el?.querySelector('input') || newPinInput.value?.input
        if (input) {
            input.focus()
            input.click()
        }
    })
}

const handleDisableOpened = () => {
    nextTick(() => {
        const input = disablePinInput.value?.$el?.querySelector('input') || disablePinInput.value?.input
        if (input) {
            input.focus()
            input.click()
        }
    })
}

const confirmPinSetup = async () => {
    try {
        await appLockStore.setupPin(newPin.value)
        ElMessage.success(t('security.pin_setup_success'))
        showPinSetup.value = false
        newPin.value = ''
    } catch (e) {
        ElMessage.error(e.message)
    }
}

const handleSetupPin = () => {
    // 强制同步执行，确在用户手势流内唤起键盘
    keyboardBridge.value?.focus()
    keyboardBridge.value?.click()

    showPinSetup.value = true
    
    // 异步接力给真正的输入框
    nextTick(() => {
        const input = newPinInput.value?.$el?.querySelector('input') || newPinInput.value?.input
        input?.focus()
        input?.click()
    })
}

const handleDisableLock = () => {
    disablePin.value = ''
    
    // 同步唤起键盘桥接器
    keyboardBridge.value?.focus()
    keyboardBridge.value?.click()

    showPinDisable.value = true

    nextTick(() => {
        const input = disablePinInput.value?.$el?.querySelector('input') || disablePinInput.value?.input
        input?.focus()
        input?.click()
    })
}

const confirmDisable = async () => {
    try {
        const success = await appLockStore.disableLock(disablePin.value)
        if (success) {
            ElMessage.success(t('security.pin_disable_success'))
            showPinDisable.value = false
            disablePin.value = ''
        } else {
            ElMessage.error(t('security.pin_verify_failed'))
        }
    } catch (e) {
        ElMessage.error(e.message)
    }
}



const handleBiometricToggle = async (val) => {
    try {
        if (val === true) {
            const success = await appLockStore.enableBiometric(authStore.userInfo)
            if (success) {
                ElMessage.success(t('security.biometric_enabled'))
            }
        } else {
            // Restore to PIN only
            await appLockStore.updateLockMode('pin')
            ElMessage.success(t('security.biometric_disabled'))
        }
    } catch (e) {
        if (e.message === 'E_PRF_NOT_SUPPORTED') {
            ElMessageBox.alert(
                t('security.biometric_hardware_unsupported_msg'),
                t('security.biometric_hardware_unsupported_title'),
                { type: 'warning', confirmButtonText: t('common.understand') }
            )
        } else {
            ElMessage.error(e.message || t('security.biometric_enable_failed'))
        }
    }
}



const handleOfflineToggle = (val) => {
    if (val === true) {
        showReadinessDialog.value = true
    } else {
        layoutStore.setOfflineMode(false)
    }
}
</script>


