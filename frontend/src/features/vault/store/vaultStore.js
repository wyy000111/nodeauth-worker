import { defineStore } from 'pinia'
import { ref } from 'vue'
import { encryptDataWithPassword, decryptDataWithPassword } from '@/shared/utils/crypto'
import { getIdbItem, setIdbItem } from '@/shared/utils/idb'
import { useAppLockStore } from '@/features/applock/store/appLockStore'

export const useVaultStore = defineStore('vault', () => {
  const appLockStore = useAppLockStore()
  const hasVault = ref(false)
  const isDirty = ref(false)


  // 初始化检查
  const init = async () => {
    const encrypted = await getIdbItem('vault:data:main')
    hasVault.value = !!encrypted
  }

  // 加载数据
  const getData = async () => {
    const key = await appLockStore.getDeviceKey()

    // 🛡️ 防御：如果被锁定，静默返回空结果，而不是抛出中断异常
    if (!key) {
      if (appLockStore.isLocked) return { vault: [] }
      throw new Error('设备授权信息已失效，请重新登录')
    }

    const encrypted = await getIdbItem('vault:data:main')
    if (!encrypted) return { vault: [] }

    try {
      return await decryptDataWithPassword(encrypted, key)
    } catch (e) {
      // 若解密失败（极少情况如果用户清库或密钥被篡改），强行回退给空库
      return { vault: [] }
    }
  }

  // 持久化数据
  const saveData = async (data) => {
    const key = await appLockStore.getDeviceKey()
    if (!key) throw new Error('设备授权信息已失效，请重新登录')
    const encrypted = await encryptDataWithPassword(data, key)
    await setIdbItem('vault:data:main', encrypted)
    hasVault.value = true
  }

  /**
   * 🛡️ 架构师重构: 仅清理金库自身的内存状态
   * 不再干预 Security 组件的锁定状态
   */
  const reset = () => {
    isDirty.value = false
    hasVault.value = false
  }

  // 残留供部分旧UI避免报错的空函数
  const unlock = async () => true
  const setup = async () => { }

  return {
    hasVault,
    isDirty,
    init,
    getData,
    markDirty: () => { isDirty.value = true },
    clearDirty: () => { isDirty.value = false },
    saveData,
    unlock,
    setup,
    reset
  }
})