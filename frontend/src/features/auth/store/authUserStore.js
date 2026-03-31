import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authService } from '@/features/auth/service/authService'
import { useVaultStore } from '@/features/vault/store/vaultStore'
import { useAppLockStore } from '@/features/applock/store/appLockStore'
import { useVaultSyncStore } from '@/features/vault/store/vaultSyncStore'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { useQueryClient } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { setIdbItem, getIdbItem, clearIdbStore } from '@/shared/utils/idb'

export const useAuthUserStore = defineStore('authUserInfo', () => {
  const appLockStore = useAppLockStore()
  const syncStore = useVaultSyncStore()
  const queryClient = useQueryClient()
  const router = useRouter()

  const userInfo = ref({})
  const isInitialized = ref(false) // 👈 架构师核心改进: 生命周期标记位
  const needsEmergency = ref(false)
  const tempEncryptionKey = ref('')
  const isVerifying = ref(false)   // 后台网络验证 Session 期间为 true，用于 Loading 显示

  // 标记后台验证开始和结束
  const startVerifying = () => { isVerifying.value = true }
  const stopVerifying = () => { isVerifying.value = false }
  const markInitialized = () => { isInitialized.value = true }

  const setUserInfo = async (info, emergency = false, key = '', deviceKey = '') => {
    userInfo.value = info
    needsEmergency.value = emergency
    tempEncryptionKey.value = key
    await setIdbItem('auth:user:profile', info)

    // 🛡️ 架构师修复: 通过 SecurityStore 统一管理密钥落盘
    if (deviceKey) {
      await appLockStore.setDeviceKey(deviceKey)
    }
  }

  const init = async () => {
    const stored = await getIdbItem('auth:user:profile')
    if (stored) {
      userInfo.value = stored
    }
    // 注意: init 只还原 IDB 内存状态，不代表“脉冲同步”完成，初始化位由 fetchUserInfo 控制
  }

  const clearUserInfo = async () => {
    const vaultStore = useVaultStore()
    const layoutStore = useLayoutStore()

    // 1. 🛡️ 架构师核心重构：各组件并行执行复位 (职责分离)
    // 安全组件重置锁定状态
    appLockStore.reset()
    // 金库组件擦除自身内存
    vaultStore.reset()

    // 2. 物理与持久化全量劫掠 (IDB/Cache)
    await clearIdbStore()
    await syncStore.clearQueue()
    queryClient.clear()

    userInfo.value = {}
    needsEmergency.value = false
    tempEncryptionKey.value = ''

    // 2. UI 状态复原
    layoutStore.resetHomeTab()
    isInitialized.value = true
  }

  const logout = async () => {
    try {
      await authService.logout()
    } finally {
      // 🛡️ 无论服务器注销是否成功，本地数据必须物理销毁
      await clearUserInfo()
      router.push('/login')
    }
  }

  const fetchUserInfo = async () => {
    const data = await authService.fetchMe()
    if (data && data.success) {
      // NOTE: fetchMe might not return needsEmergency as it's only returned during login callback
      // but we might want the server to actually keep track of this in the session if possible.
      // For now, it's primarily used during initial login pulse.
      await setUserInfo(data.userInfo, !!data.needsEmergency, data.encryptionKey || '', data.deviceKey || '')
      return true
    } else {
      await clearUserInfo()
      return false
    }
  }

  return {
    userInfo,
    isInitialized,
    isVerifying,
    needsEmergency,
    tempEncryptionKey,
    setUserInfo,
    clearUserInfo,
    logout,
    fetchUserInfo,
    init,
    startVerifying,
    stopVerifying,
    markInitialized
  }
})