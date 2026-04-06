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

  /**
   * 🏛️ 枢纽方法：同步离线就绪度元数据 (物理+逻辑双修)
   * @param {Object} options 
   * @param {number} [options.serverTotal] - 更新服务器权威总量 (来自分页头/全量同步)
   * @param {number} [options.delta] - 动态增量 (在线增删动作的实时补偿，支持批量)
   * @param {number} [options.localCount] - 显式指定本地缓存数量 (通常由 saveData 内部调度)
   */
  const updateMetadata = async ({ serverTotal, delta = 0, localCount = undefined } = {}) => {
    // --- 1. 同步物理存量 (分子) ---
    // 🛡️ 严格设计：分子只在明确物理落盘 (saveData) 或 IDB 完全丢失时才更新
    if (localCount !== undefined) {
      await setIdbItem('vault:meta:local_count', localCount)
    } else {
      // 弹性自愈：仅当 IDB 里的分子丢失时，才费劲去解密数一遍
      const existing = await getIdbItem('vault:meta:local_count')
      if (existing === undefined) {
        const data = await getData()
        await setIdbItem('vault:meta:local_count', data.vault?.length || 0)
      }
    }

    // --- 2. 同步逻辑总量 (分母) ---
    let currentServer = await getIdbItem('vault:meta:server_total') || 0
    if (serverTotal !== undefined) {
      currentServer = serverTotal
    } else if (delta !== 0) {
      // 🚀 实时补偿：分母随在线增删动作动态平移
      currentServer = Math.max(0, currentServer + delta)
    }
    await setIdbItem('vault:meta:server_total', currentServer)
  }

  // 持久化数据
  const saveData = async (data) => {
    const key = await appLockStore.getDeviceKey()
    if (!key) throw new Error('设备授权信息已失效，请重新登录')
    const encrypted = await encryptDataWithPassword(data, key)
    await setIdbItem('vault:data:main', encrypted)

    // 💡 实时对账：只要数据落盘，就自动更新分子数量
    await updateMetadata({ localCount: data.vault?.length || 0 })

    hasVault.value = true
  }

  /**
   * 彻底删除物理缓存中的账号实体
   * 防止 Upsert Merge 保护机制导致被删账号永远残留在本地硬盘中，出现“离线幽灵数据”
   * @param {string[]} ids 
   */
  const deleteItems = async (ids) => {
    if (!ids || ids.length === 0) return
    const dbData = await getData()
    if (dbData && dbData.vault) {
      const newVault = dbData.vault.filter(item => !ids.includes(item.id))
      await saveData({ vault: newVault, categoryStats: dbData.categoryStats || [] })
    }
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
    updateMetadata,
    deleteItems,
    unlock,
    setup,
    reset
  }
})