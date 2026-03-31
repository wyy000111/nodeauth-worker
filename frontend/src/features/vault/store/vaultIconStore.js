import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 缓存已成功获取到的 Logo URL，减少重复竞速请求
 */
export const useVaultIconStore = defineStore('vaultIcon', () => {
    // 映射表: domain -> bestUrl
    const iconCache = ref(JSON.parse(localStorage.getItem('app_vault_icon_cache') || '{}'))

    const getCachedIcon = (domain) => {
        return iconCache.value[domain] || null
    }

    const setCachedIcon = (domain, url) => {
        iconCache.value[domain] = url
        // 异步排查持久化
        localStorage.setItem('app_vault_icon_cache', JSON.stringify(iconCache.value))
    }

    return {
        iconCache,
        getCachedIcon,
        setCachedIcon
    }
})
