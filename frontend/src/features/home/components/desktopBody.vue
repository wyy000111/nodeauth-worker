<template>
  <el-main class="main-content">
    <Transition :name="layoutStore.pageTransition" mode="out-in">
      <div :key="layoutStore.app_active_tab" class="view-container">
        <!-- 核心视图 -->
        <VaultList 
          v-if="layoutStore.app_active_tab === 'vault'" 
          ref="vaultListRef" 
          @switch-tab="layoutStore.setActiveTab" 
        />

        <!-- 功能模块 -->
        <AddVault         v-else-if="layoutStore.app_active_tab === 'add-vault'" @success="handleSuccess" />
        <DataExport       v-else-if="layoutStore.app_active_tab === 'migration-export'" />
        <DataImport       v-else-if="layoutStore.app_active_tab === 'migration-import'" @success="handleSuccess" />
        <DataBackup       v-else-if="layoutStore.app_active_tab === 'backups'" @success="handleSuccess" />
        <UtilityTools     v-else-if="layoutStore.app_active_tab === 'tools'" />
        
        <!-- 设置模块 -->
        <PasskeySettings   v-else-if="layoutStore.app_active_tab === 'settings-passkey'" />
        <SecuritySettings  v-else-if="layoutStore.app_active_tab === 'settings-security'" />
        <AppearanceSetting v-else-if="layoutStore.app_active_tab === 'settings-appearance'" />
        <LanguageSettings  v-else-if="layoutStore.app_active_tab === 'settings-language'" />
        <ThemeSettings     v-else-if="layoutStore.app_active_tab === 'settings-theme'" />
        <LayoutSettings    v-else-if="layoutStore.app_active_tab === 'settings-layout'" />
        <DeviceSettings    v-else-if="layoutStore.app_active_tab === 'settings-devices'" />
        <AboutView         v-else-if="layoutStore.app_active_tab === 'settings-about'" />
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

// 异步组件定义 (PC端逻辑)
const VaultList = createAsyncComponent(() => import('@/features/vault/views/vaultList.vue'))
const AddVault = createAsyncComponent(() => import('@/features/vault/views/addVault.vue'))
const DataExport = createAsyncComponent(() => import('@/features/migration/views/dataExport.vue'))
const DataImport = createAsyncComponent(() => import('@/features/migration/views/dataImport.vue'))
const DataBackup = createAsyncComponent(() => import('@/features/backup/views/dataBackup.vue'))
const UtilityTools = createAsyncComponent(() => import('@/features/tools/views/utilityTools.vue'))
const PasskeySettings = createAsyncComponent(() => import('@/features/settings/views/passkeySettings.vue'))
const SecuritySettings = createAsyncComponent(() => import('@/features/settings/views/securitySettings.vue'))
const AppearanceSetting = createAsyncComponent(() => import('@/features/settings/views/appearanceSetting.vue'))
const LanguageSettings = createAsyncComponent(() => import('@/features/settings/views/languageSettings.vue'))
const ThemeSettings = createAsyncComponent(() => import('@/features/settings/views/themeSettings.vue'))
const LayoutSettings = createAsyncComponent(() => import('@/features/settings/views/layoutSettings.vue'))
const DeviceSettings = createAsyncComponent(() => import('@/features/settings/views/devicesSettings.vue'))
const AboutView = createAsyncComponent(() => import('@/features/settings/views/aboutView.vue'))

// 逻辑：成功回调与重刷
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

// 监听头部 Logo 点击事件与 Tab 修正
watch(() => layoutStore.homeTabReset, () => {
  if (layoutStore.app_active_tab === 'vault') {
    vaultListRef.value?.fetchVault()
  } else {
    layoutStore.setActiveTab('vault')
    pendingRefetch = true
  }
})

// 切换 Tab 时重置滚动
watch(() => layoutStore.app_active_tab, () => {
  nextTick(() => {
    window.scrollTo(0, 0)
    const mainContentEl = document.querySelector('.main-content')
    if (mainContentEl) mainContentEl.scrollTop = 0
  })
})
</script>
