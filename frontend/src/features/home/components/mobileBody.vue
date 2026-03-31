<template>
  <el-main class="main-content has-bottom-nav">
    <Transition :name="layoutStore.pageTransition" mode="out-in">
      <div :key="layoutStore.app_active_tab" class="view-container">
        <!-- 核心视图 -->
        <VaultList 
          v-if="layoutStore.app_active_tab === 'vault'" 
          ref="vaultListRef" 
          @switch-tab="layoutStore.setActiveTab" 
        />

        <!-- 移动端枢纽页 (Hub & About) -->
        <MobileHub v-else-if="layoutStore.app_active_tab === 'mobile-data'" mode="data" @select="layoutStore.setActiveTab" />
        <MobileHub v-else-if="layoutStore.app_active_tab === 'mobile-settings'" mode="settings" @select="layoutStore.setActiveTab" />
        <AboutView v-else-if="layoutStore.app_active_tab === 'settings-about'" />

        <!-- 三级功能模块 -->
        <AddVault         v-else-if="layoutStore.app_active_tab === 'add-vault'" @success="handleSuccess" />
        <DataExport       v-else-if="layoutStore.app_active_tab === 'migration-export'" />
        <DataImport       v-else-if="layoutStore.app_active_tab === 'migration-import'" @success="handleSuccess" />
        <DataBackup       v-else-if="layoutStore.app_active_tab === 'backups'" @success="handleSuccess" />
        <UtilityTools     v-else-if="layoutStore.app_active_tab === 'tools'" />
        
        <!-- 设置子页面 -->
        <PasskeySettings    v-else-if="layoutStore.app_active_tab === 'settings-passkey'" />
        <AppearanceSetting  v-else-if="layoutStore.app_active_tab === 'settings-appearance'" />
        <SecuritySettings    v-else-if="layoutStore.app_active_tab === 'settings-security'" />
        <LanguageSettings    v-else-if="layoutStore.app_active_tab === 'settings-language'" />
        <ThemeSettings       v-else-if="layoutStore.app_active_tab === 'settings-theme'" />
        <LayoutSettings      v-else-if="layoutStore.app_active_tab === 'settings-layout'" />
        <DeviceSettings      v-else-if="layoutStore.app_active_tab === 'settings-devices'" />
      </div>
    </Transition>
  </el-main>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { createAsyncComponent } from '@/shared/utils/asyncHelper'

const layoutStore = useLayoutStore()
const vaultListRef = ref(null)

// 异步组件定义 (全量包含移动端特有组件)
const VaultList = createAsyncComponent(() => import('@/features/vault/views/vaultList.vue'))
const MobileHub = createAsyncComponent(() => import('@/features/home/views/mobileHub.vue'))
const AboutView = createAsyncComponent(() => import('@/features/settings/views/aboutView.vue'))
const AddVault = createAsyncComponent(() => import('@/features/vault/views/addVault.vue'))
const DataExport = createAsyncComponent(() => import('@/features/migration/views/dataExport.vue'))
const DataImport = createAsyncComponent(() => import('@/features/migration/views/dataImport.vue'))
const DataBackup = createAsyncComponent(() => import('@/features/backup/views/dataBackup.vue'))
const UtilityTools = createAsyncComponent(() => import('@/features/tools/views/utilityTools.vue'))
const PasskeySettings = createAsyncComponent(() => import('@/features/settings/views/passkeySettings.vue'))
const AppearanceSetting = createAsyncComponent(() => import('@/features/settings/views/appearanceSetting.vue'))
const SecuritySettings = createAsyncComponent(() => import('@/features/settings/views/securitySettings.vue'))
const LanguageSettings = createAsyncComponent(() => import('@/features/settings/views/languageSettings.vue'))
const ThemeSettings = createAsyncComponent(() => import('@/features/settings/views/themeSettings.vue'))
const LayoutSettings = createAsyncComponent(() => import('@/features/settings/views/layoutSettings.vue'))
const DeviceSettings = createAsyncComponent(() => import('@/features/settings/views/devicesSettings.vue'))

// 逻辑处理
let pendingRefetch = false
const handleSuccess = () => {
  layoutStore.setActiveTab('vault')
  if (vaultListRef.value) {
    nextTick(() => vaultListRef.value?.fetchVault())
  } else {
    pendingRefetch = true
  }
}

watch(vaultListRef, (el) => {
  if (el && pendingRefetch) {
    pendingRefetch = false
    nextTick(() => el.fetchVault())
  }
})

watch(() => layoutStore.homeTabReset, () => {
  layoutStore.setActiveTab('vault')
  pendingRefetch = true
})

// 滚动行为
watch(() => layoutStore.app_active_tab, () => {
  nextTick(() => {
    // 关键修复：直接获取 #app 容器
    const appContainer = document.querySelector('#app')
    if (appContainer) {
      appContainer.scrollTop = 0
    }

    // 针对 iOS 的特殊双重保险：
    // 如果有 Transition 动画，nextTick 可能太快，补一个微小延迟
    setTimeout(() => {
      if (appContainer && appContainer.scrollTop !== 0) {
        appContainer.scrollTop = 0
      }
    }, 10)
  })
})
</script>
