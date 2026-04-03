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

        <div class="pin-display mb-30" :class="{ 'shake': isError }">
          <div 
            v-for="i in 6" 
            :key="i" 
            class="pin-dot" 
            :class="{ 'is-filled': pin.length >= i }"
          ></div>
        </div>

        <div class="keypad">
          <button v-for="n in 9" :key="n" @click="handleKey(n.toString())">{{ n }}</button>
          <button class="btn-extra btn-biometric" @click="handleBiometric(true)" v-if="['biometric', 'biometric_compat'].includes(appLockStore.lockMode)">
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

        <!-- 🧪 [DEBUG] PWA 底部调试日志面板 (生产环境已注释，排查生物识别死锁时请取消注释即可，禁止删除此代码段)
        <div class="pwa-debug-panel" v-if="debugLogs.length > 0">
           <div v-for="(log, idx) in debugLogs" :key="idx" class="pwa-debug-row">
              {{ log }}
           </div>
        </div>
        -->
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
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

/** 
 * 🧪 [DEBUG] PWA 屏幕日志系统 (仅排查死锁时启用，生产环境已空置，禁止删除)
 */
const debugLogs = ref([])
const addLog = (msg) => {
    /* 如需在页面实时查看日志，取消下列注释并开启 Template 对应代码段即可
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    debugLogs.value.push(`[${time}] ${msg}`)
    if (debugLogs.value.length > 6) debugLogs.value.shift()
    */
    console.log(`[PWA-Debug] ${msg}`)
}

const handleKey = (val) => {
  if (pin.value.length < 6) pin.value += val
}

const handleDelete = () => {
  pin.value = pin.value.slice(0, -1)
}

/**
 * 🧬 生物识别解锁逻辑
 */
const handleBiometric = async (isManual = false) => {
    if (!isVisible.value) return
    
    try {
        addLog(isManual ? '👉 用户手动触发生物识别' : '🤖 系统探测到前台激活，尝试自动唤起')
        const success = await appLockStore.unlockWithBiometric(isManual)
        if (success) {
            addLog('✅ 解锁成功')
            ElMessage.success(t('security.unlocked'))
        }
    } catch (e) {
        const errorName = e?.name || e?.message
        addLog(`❌ 验证异常: ${errorName}`)
        
        // 🛡️ 架构师优化：针对自动唤起（isManual=false）抛出的 NotAllowedError 进行静默处理
        // 因为这在 iOS PWA 环境下是已知的系统级限制，静默处理能给用户带来最顺滑的降级体验
        if (!isManual && (errorName === 'NotAllowedError' || errorName === 'AbortError')) {
            console.warn('[PWA-AppLock] Auto-prompt blocked by OS (Expected behavior on iOS)')
            return
        }

        // 仅在手动点击且报错时，才向用户显示具体的验证失败原因
        if (isManual) {
            console.error('Biometric Auth Error:', e)
        }
    }
}

/**
 * 🛡️ 全局可见性监听（解决切应用回来的自动唤起问题）
 */
const onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && isVisible.value) {
        addLog('监测到 App 回到前台')
        // iOS 需要短暂延时以确保系统 UI 归位后才能再次唤起弹窗
        setTimeout(() => handleBiometric(false), 500)
    }
}

onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange)
    // 首次加载/挂载时的自动尝试
    if (isVisible.value) {
        setTimeout(() => handleBiometric(false), 500)
    }
})

onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
})

/**
 * 🛡️ 状态跃迁监听：当 isLocked 从 false 变为 true 时触发
 */
watch(() => appLockStore.isLocked, (locked) => {
    if (locked) {
        addLog('系统锁定状态激活')
        setTimeout(() => handleBiometric(false), 500)
    }
})

/**
 * 🛡️ PIN 码自动提交逻辑
 */
watch(pin, async (newVal) => {
  if (newVal.length === 6 && !appLockStore.isUnlocking) {
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
  }
})

const handleEmergencyReset = () => {
  ElMessageBox.confirm(
    t('security.reset_confirm_message'),
    t('security.reset_confirm_title'),
    { confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel'), type: 'warning' }
  ).then(async () => {
    await authStore.logout()
    const { removeIdbItem } = await import('@/shared/utils/idb')
    await Promise.all([
        removeIdbItem('sys:sec:enc_device_salt'),
        removeIdbItem('sys:sec:lock_mode'),
        removeIdbItem('sys:sec:bio_cred_id'),
        removeIdbItem('sys:sec:bio_enc_salt'),
        removeIdbItem('sys:sec:bio_wrap_key')
    ])
    localStorage.clear()
    window.location.reload()
  })
}
</script>

<style scoped>
.security-lock-overlay {
  position: fixed;
  top: 0; left: 0; width: 100vw; height: 100vh;
  background: var(--el-bg-color);
  z-index: 2000;
  display: flex; align-items: center; justify-content: center;
}
.lock-panel { text-align: center; width: 100%; max-width: 320px; padding: 20px; }
.lock-icon-circle {
  width: 80px; height: 80px; background: var(--el-color-primary-light-9);
  color: var(--el-color-primary); border-radius: 50%;
  display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;
}
.pin-display { display: flex; justify-content: center; gap: 15px; padding-top:10px; }
.pin-dot { width: 14px; height: 14px; border: 2px solid var(--el-border-color); border-radius: 50%; transition: all 0.2s; }
.pin-dot.is-filled { background: var(--el-color-primary); border-color: var(--el-color-primary); transform: scale(1.1); }
.keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
.keypad button {
  margin: 0 auto; height: 64px; width: 64px; border-radius: 50%; border: none;
  background: var(--el-fill-color-light); font-size: 24px; cursor: pointer;
  transition: all 0.1s; display: flex; align-items: center; justify-content: center;
  touch-action:none;
}
.keypad button:active { background: var(--el-fill-color-darker); transform: scale(0.95); }
.btn-extra { 
    font-size: 18px !important; 
}
.btn-biometric {
    color: var(--el-color-primary);
    animation: biometric-pulse 2s infinite ease-in-out;
}
@keyframes biometric-pulse {
    0% { background: var(--el-fill-color-light); transform: scale(1); box-shadow: 0 0 0 0 rgba(var(--el-color-primary-rgb), 0); }
    50% { background: var(--el-color-primary-light-9); transform: scale(1.05); box-shadow: 0 0 10px 2px rgba(var(--el-color-primary-rgb), 0.2); }
    100% { background: var(--el-fill-color-light); transform: scale(1); box-shadow: 0 0 0 0 rgba(var(--el-color-primary-rgb), 0); }
}
.shake { animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both; }
@keyframes shake {
  10%, 90% { transform: translate3d(-1px, 0, 0); }
  20%, 80% { transform: translate3d(2px, 0, 0); }
  30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
  40%, 60% { transform: translate3d(4px, 0, 0); }
}

/* 🧪 [DEBUG] 底部日志样式 (排查死锁专用，禁止删除) */
/*
.pwa-debug-panel {
    position: absolute; bottom: 20px; left: 20px; right: 20px;
    background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px;
    padding: 10px; font-family: monospace; font-size: 10px; color: rgba(255, 255, 255, 0.7);
    pointer-events: none; display: flex; flex-direction: column; gap: 4px; z-index: 1000;
}
.pwa-debug-row {
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    padding-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
*/
</style>
