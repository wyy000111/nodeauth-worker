<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { Warning, Lock } from '@element-plus/icons-vue'
import MainLayout from '@/app/layouts/mainLayout.vue'
import BlankLayout from '@/app/layouts/blankLayout.vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'

import AppLockOverlay from '@/features/applock/components/appLockOverlay.vue'
import { useAppLockStore } from '@/features/applock/store/appLockStore'

const { locale } = useI18n()
const elementLocale = computed(() => {
  return locale.value === 'zh-CN' ? zhCn : en
})

const route = useRoute()
const router = useRouter()
const layoutStore = useLayoutStore()
const appLockStore = useAppLockStore()

const layoutComponent = computed(() => {
  if (route.meta.layout === 'blank' || !route.meta.requiresAuth) {
    return BlankLayout
  }
  return MainLayout
})

// 移动端菜单打开时锁定背景滚动
watch(() => layoutStore.showMobileMenu, (newVal) => {
  if (newVal) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

const checkMobile = () => {
  layoutStore.isMobile = window.innerWidth < 768
}

const userClosedOfflineBanner = ref(false)
const showOfflineBanner = computed(() => layoutStore.isPhysicalOffline && !userClosedOfflineBanner.value)

watch(() => layoutStore.isPhysicalOffline, (isPhysical) => {
  if (isPhysical) {
    userClosedOfflineBanner.value = false
  }
})

// 防窥屏全局遮罩逻辑
const isAppHidden = ref(false)
const handleVisibilityChange = () => {
  isAppHidden.value = document.hidden
}

// == 静默预热机制 (Background Idle Prefetching) ==
// 针对因体积庞大被 vite.config.js 中排除的依赖，在首屏彻底可用后空闲时间拉取，实现 100% 完美离线
const silentPrefetchDependencies = () => {
  const prefetchTask = () => {
    if (layoutStore.isOffline) return
    console.log('Initiating background prefetching of advanced capabilities...')
    // 按需预下载大型视图与它们的深度依赖 (openpgp, wa-sqlite, argon2等)
    Promise.allSettled([
      import('@/features/migration/views/dataExport.vue'),
      import('@/features/migration/views/dataImport.vue'),
      import('@/features/backup/views/dataBackup.vue'),
      import('@/features/tools/views/utilityTools.vue'),
      import('@/features/migration/service/dataMigrationService.js'),
      import('@/features/settings/views/passkeySettings.vue'),
      import('@/features/emergency/views/emergency.vue')
    ])

  }

  if (window.requestIdleCallback) {
    // 延迟 5 秒保证连页面的其他低优微小请求都不被干扰
    window.setTimeout(() => window.requestIdleCallback(prefetchTask), 5000)
  } else {
    window.setTimeout(prefetchTask, 8000)
  }
}

onMounted(() => {
  checkMobile()
  layoutStore.initNetworkStatus()
  appLockStore.init() // 🟢 还原锁定状态
  window.addEventListener('resize', checkMobile)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // 触发后台静默预热
  silentPrefetchDependencies()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', checkMobile)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <el-config-provider :locale="elementLocale">
    <!-- 主体应用 -->
    <div class="app-container" :class="{ 'is-blank-layout': route.meta.layout === 'blank' || !route.meta.requiresAuth }">
      <!-- 🟢 顶层安全锁遮罩 -->
      <AppLockOverlay />

      <!-- 全局物理离线横幅 (仅物理断网显示) -->
      <el-alert
        v-if="showOfflineBanner"
        :title="$t('common.offline_mode')"
        type="warning"
        show-icon
        center
        closable
        class="global-offline-banner"
        @close="userClosedOfflineBanner = true"
      >
      </el-alert>

      <!-- 防窥屏遮罩 (兼容旧版但优先展示 SecurityLock) -->
      <div class="app-blur-overlay" v-if="layoutStore.appGhostMode && isAppHidden && !appLockStore.isLocked">
        <div class="blur-content">
          <el-icon :size="48"><Lock /></el-icon>
          <p>{{ $t('security.ghost_mode_active') }}</p>
        </div>
      </div>

    <!-- 加载动态路由 Layout (MainLayout 或 BlankLayout) -->
    <component :is="layoutComponent" />
    </div>
  </el-config-provider>
</template>


