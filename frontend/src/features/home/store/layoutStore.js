import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { i18n } from '@/locales'

export const useLayoutStore = defineStore('layout', () => {
  const isMobile = ref(false)
  const showMobileMenu = ref(false)
  const homeTabReset = ref(0)
  const app_active_tab = ref(sessionStorage.getItem('app_active_tab') || 'vault')
  const activeSubTool = ref(null) // 用于实用工具内部的二级导航
  const searchQuery = ref('')
  const isSearchVisible = ref(false)
  const pageTransition = ref('fade')
  const appVaultViewMode = ref(localStorage.getItem('app_vault_view_mode') || 'card')
  const appGhostMode = ref(localStorage.getItem('app_ghost_mode') === 'true')
  const appOfflineMode = ref(localStorage.getItem('app_offline_mode') === 'true')
  const isSidebarCollapsed = ref(localStorage.getItem('app_sidebar_collapse') !== 'false')

  const setGhostMode = (mode) => {
    appGhostMode.value = mode
    localStorage.setItem('app_ghost_mode', String(mode))
  }

  const setOfflineMode = (mode) => {
    appOfflineMode.value = mode
    localStorage.setItem('app_offline_mode', String(mode))
  }

  // 网络状态监控
  const isPhysicalOffline = ref(typeof navigator !== 'undefined' ? !navigator.onLine : false) // 纯净的物理环境状态
  const isManualOffline = computed(() => appOfflineMode.value)
  const isOffline = computed(() => isPhysicalOffline.value || isManualOffline.value)
  const isLoadingSearching = ref(false)

  // 导航层级定义：二级页面 -> 父级页面
  const NAV_HIERARCHY = {
    'add-vault': 'vault',
    'mobile-data': 'vault',
    'mobile-settings': 'vault',
    'migration-export': 'mobile-data',
    'migration-import': 'mobile-data',
    'backups': 'mobile-data',
    'tools': 'vault',
    'settings-passkey': 'mobile-settings',
    'settings-about': 'mobile-settings',
    'settings-appearance': 'mobile-settings',
    'settings-language': 'settings-appearance',
    'settings-theme': 'settings-appearance',
    'settings-layout': 'settings-appearance',
    'settings-security': 'mobile-settings',
    'settings-devices': 'settings-security'
  }

  const toggleSearch = (show) => {
    isSearchVisible.value = show !== undefined ? show : !isSearchVisible.value
    if (!isSearchVisible.value) searchQuery.value = ''
  }

  const canGoBack = computed(() => {
    if (activeSubTool.value) return true
    return !!NAV_HIERARCHY[app_active_tab.value]
  })

  const goBack = () => {
    if (activeSubTool.value) {
      activeSubTool.value = null
      pageTransition.value = 'slide-right'
      return
    }

    const parent = NAV_HIERARCHY[app_active_tab.value]
    if (parent) {
      pageTransition.value = 'slide-right'
      setActiveTab(parent)
    }
  }

  const setActiveTab = (tab) => {
    const oldTab = app_active_tab.value
    activeSubTool.value = null // 切换大 Tab 时重置子工具

    // 自动判定动效：如果新 Tab 是旧 Tab 的父级，则向右滑出；如果是子级，则向左切入
    if (NAV_HIERARCHY[oldTab] === tab) {
      pageTransition.value = 'slide-right'
    } else if (NAV_HIERARCHY[tab] === oldTab) {
      pageTransition.value = 'slide-left'
    } else {
      pageTransition.value = 'fade'
    }

    app_active_tab.value = tab
    sessionStorage.setItem('app_active_tab', tab)
    // 切换 Tab 时自动关闭搜索栏
    isSearchVisible.value = false
    searchQuery.value = ''
  }

  const resetHomeTab = () => {
    app_active_tab.value = 'vault'
    homeTabReset.value++
  }

  const toggleSidebar = () => {
    isSidebarCollapsed.value = !isSidebarCollapsed.value
    localStorage.setItem('app_sidebar_collapse', isSidebarCollapsed.value)
  }

  const setVaultViewMode = (mode) => {
    appVaultViewMode.value = mode
    localStorage.setItem('app_vault_view_mode', mode)
  }

  const initNetworkStatus = () => {
    // 监听真实物理网络状态
    window.addEventListener('online', () => {
      isPhysicalOffline.value = false
    })
    window.addEventListener('offline', () => {
      isPhysicalOffline.value = true
    })
    // 初始化同步
    if (typeof navigator !== 'undefined') {
      isPhysicalOffline.value = !navigator.onLine
    }
  }

  // 仅负责 UI 提示，无需同步改写 isOffline，因为 computed 会自动衍生
  watch(appOfflineMode, (val) => {
    if (val) {
      ElMessage.success({
        message: i18n.global.t('security.offline_mode_active') || 'Air-Gapped Mode Enabled',
        grouping: true
      })
    } else {
      ElMessage.success({
        message: i18n.global.t('security.offline_mode_inactive') || 'Air-Gapped Mode Disabled. Syncing...',
        grouping: true
      })
    }
  })

  watch(appGhostMode, (val) => {
    if (val) {
      ElMessage.success({
        message: i18n.global.t('security.ghost_mode_active') || 'Ghost Mode Enabled',
        grouping: true
      })
    } else {
      ElMessage.success({
        message: i18n.global.t('security.ghost_mode_inactive') || 'Ghost Mode Disabled',
        grouping: true
      })
    }
  })

  return {
    isMobile,
    showMobileMenu,
    homeTabReset,
    app_active_tab,
    activeSubTool,
    searchQuery,
    isSearchVisible,
    isLoadingSearching,
    canGoBack,
    isOffline,
    isPhysicalOffline,
    isManualOffline,
    pageTransition,
    toggleSearch,
    setActiveTab,
    goBack,
    resetHomeTab,
    initNetworkStatus,
    appVaultViewMode,
    setVaultViewMode,
    appGhostMode,
    setGhostMode,
    appOfflineMode,
    setOfflineMode,
    isSidebarCollapsed,
    toggleSidebar
  }
})