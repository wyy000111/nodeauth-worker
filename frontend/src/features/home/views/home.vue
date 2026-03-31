<template>
  <el-container class="home-container">
    <el-container class="main-body">
      <!-- 桌面端渲染逻辑 -->
      <template v-if="!layoutStore.isMobile">
        <desktopMenu
          :app_active_tab="layoutStore.app_active_tab" 
          @select="layoutStore.setActiveTab" 
        />
        <desktopBody />
      </template>

      <!-- 移动端渲染逻辑 -->
      <template v-else>
        <mobileBody />
      </template>
    </el-container>
    
    <!-- 移动端底栏导航 -->
    <MobileMenu 
      v-if="layoutStore.isMobile" 
      :app_active_tab="layoutStore.app_active_tab"
      @select="layoutStore.setActiveTab"
    />
  </el-container>
</template>

<script setup>
import { onMounted } from 'vue'
import desktopMenu from '@/features/home/components/desktopMenu.vue'
import MobileMenu from '@/features/home/components/mobileMenu.vue'
import desktopBody from '@/features/home/components/desktopBody.vue'
import mobileBody from '@/features/home/components/mobileBody.vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'

const layoutStore = useLayoutStore()

onMounted(() => {
  // 首页状态校准：防止从非正常路径进入时显示非法 Tab
  const validTabs = [
    'vault', 'add-vault', 'tools', 'backups', 
    'migration-export', 'migration-import'
  ]
  if (layoutStore.isMobile) {
    validTabs.push('mobile-data', 'mobile-settings')
  }
  
  // 对于设置类页面，允许以 settings- 开头的所有状态
  const isSettings = layoutStore.app_active_tab.startsWith('settings-')
  
  if (!validTabs.includes(layoutStore.app_active_tab) && !isSettings) {
    layoutStore.setActiveTab('vault')
  }
})
</script>