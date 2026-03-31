<template>
  <transition name="el-fade-in">
    <div v-if="isVisible" class="security-lock-overlay">

      <div class="lock-panel">
        <div class="lock-header">
          <div class="lock-icon-circle">
            <el-icon :size="32"><Lock /></el-icon>
          </div>
          <h2>{{ $t('security.app_locked') }}</h2>
          <p>{{ $t('security.enter_pin_to_unlock') }}</p>
        </div>

        <!-- PIN Dots Display -->
        <div class="pin-display mb-30" :class="{ 'shake': isError }">
          <div 
            v-for="i in 6" 
            :key="i" 
            class="pin-dot" 
            :class="{ 'is-filled': pin.length >= i }"
          ></div>
        </div>

        <!-- Numeric Keypad -->
        <div class="keypad">
          <button v-for="n in 9" :key="n" @click="handleKey(n.toString())">{{ n }}</button>
          <button class="btn-extra" @click="handleBiometric" v-if="['biometric', 'biometric_compat'].includes(appLockStore.lockMode)">
             <el-icon><Fingerprint /></el-icon>
          </button>

          <button class="btn-extra" v-else @click="pin = ''">C</button>
          <button @click="handleKey('0')">0</button>
          <button class="btn-extra" @click="handleDelete">
             <el-icon><Back /></el-icon>
          </button>
        </div>

        <div class="lock-footer mt-20">
          <el-button link type="info" @click="handleEmergencyReset">
            {{ $t('security.forgot_pin') }}
          </el-button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { useRoute } from 'vue-router'

import { Lock, Back } from '@element-plus/icons-vue'
import Fingerprint from '@/shared/components/icons/iconFingerprint.vue'
import { useAppLockStore } from '../store/appLockStore'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const appLockStore = useAppLockStore()
const authStore = useAuthUserStore()
const route = useRoute()

const isVisible = computed(() => appLockStore.isLocked && route.meta.requiresAuth && !route.meta.skipPinLock)


const pin = ref('')
const isError = ref(false)
const isUnlocking = ref(false)


const handleKey = (val) => {
  if (pin.value.length < 6) {
    pin.value += val
  }
}

const handleDelete = () => {
  pin.value = pin.value.slice(0, -1)
}

const handleBiometric = async () => {
    if (isUnlocking.value) return
    isUnlocking.value = true
    try {
        const success = await appLockStore.unlockWithBiometric()
        if (success) {
            ElMessage.success(t('security.unlocked'))
        }
    } catch (e) {
        console.error('Biometric error:', e)
    } finally {
        isUnlocking.value = false
    }
}

// 🛡️ 自动唤起验证 (无感解锁体验)
watch(() => appLockStore.isLocked, (locked) => {
    if (locked && ['biometric', 'biometric_compat'].includes(appLockStore.lockMode)) {
        setTimeout(handleBiometric, 300)
    }
}, { immediate: true })



const handleEmergencyReset = () => {
  ElMessageBox.confirm(
    t('security.reset_confirm_message'),
    t('security.reset_confirm_title'),
    {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      type: 'warning'
    }
  ).then(async () => {
    // 1. 物理注销身份（会自动清理 Profile 和基础 IDB 条目）
    await authStore.logout()

    // 2. 补漏清理 security 相关的 IndexedDB 记录
    const { removeIdbItem } = await import('@/shared/utils/idb')
    await removeIdbItem('sys:sec:enc_device_salt')
    await removeIdbItem('sys:sec:lock_mode')
    await removeIdbItem('sys:sec:bio_cred_id')
    await removeIdbItem('sys:sec:bio_enc_salt')

    // 3. 彻底重载页面（重定向到 /login）
    localStorage.clear()
    window.location.reload()
  })
}



watch(pin, async (newVal) => {
  if (newVal.length === 6 && !isUnlocking.value) {
    isUnlocking.value = true
    const success = await appLockStore.unlockWithPin(newVal)
    if (success) {
      pin.value = ''
      ElMessage.success(t('security.unlocked'))
    } else {
      isError.value = true
      setTimeout(() => {
        isError.value = false
        pin.value = ''
      }, 500)
    }
    isUnlocking.value = false
  }
})
</script>

<style scoped>
.security-lock-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: var(--el-bg-color);
  z-index: 2000;
  display: flex;

  align-items: center;
  justify-content: center;
}

.lock-panel {
  text-align: center;
  width: 100%;
  max-width: 320px;
  padding: 20px;
}

.lock-icon-circle {
  width: 80px;
  height: 80px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
}

.pin-display {
  display: flex;
  justify-content: center;
  gap: 15px;
  padding-top:10px;
}

.pin-dot {
  width: 14px;
  height: 14px;
  border: 2px solid var(--el-border-color);
  border-radius: 50%;
  transition: all 0.2s;
}

.pin-dot.is-filled {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  transform: scale(1.1);
}

.keypad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
}

.keypad button {
  margin: 0 auto;
  height: 64px;
  width: 64px;
  border-radius: 50%;
  border: none;
  background: var(--el-fill-color-light);
  font-size: 24px;
  cursor: pointer;
  transition: all 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.keypad button:active {
  background: var(--el-fill-color-darker);
  transform: scale(0.95);
}

.btn-extra {
  font-size: 18px !important;
}

.shake {
  animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both;
}

@keyframes shake {
  10%, 90% { transform: translate3d(-1px, 0, 0); }
  20%, 80% { transform: translate3d(2px, 0, 0); }
  30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
  40%, 60% { transform: translate3d(4px, 0, 0); }
}
</style>
