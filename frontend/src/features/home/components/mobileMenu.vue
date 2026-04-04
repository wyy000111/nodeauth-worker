<template>
  <nav class="mobile-menu" v-if="layoutStore.isMobile">
    <div 
      class="nav-item" 
      :class="{ active: app_active_tab === 'vault' || app_active_tab === 'add-vault' }"
      @click="handleNav('vault')"
    >
      <el-icon :size="20"><CopyDocument /></el-icon>
      <span>{{ $t('menu.mobile.vault') }}</span>
    </div>

    <div 
      class="nav-item" 
      :class="{ active: ['mobile-data', 'migration-export', 'migration-import', 'backups'].includes(app_active_tab) }"
      @click="handleNav('mobile-data')"
    >
      <el-icon :size="20"><Coin /></el-icon>
      <span>{{ $t('menu.mobile.data') }}</span>
    </div>

    <div 
      class="nav-item" 
      :class="{ active: app_active_tab === 'tools' || app_active_tab.startsWith('tool-') }"
      @click="handleNav('tools')"
    >
      <el-icon :size="20"><IconToolbox /></el-icon>
      <span>{{ $t('menu.mobile.tools') }}</span>
    </div>

    <div 
      class="nav-item" 
      :class="{ active: app_active_tab === 'mobile-settings' || app_active_tab.startsWith('settings-') }"
      @click="handleNav('mobile-settings')"
    >
      <el-icon :size="20"><Setting /></el-icon>
      <span>{{ $t('menu.mobile.settings') }}</span>
    </div>
  </nav>
</template>

<script setup>
import { CopyDocument, Coin, Setting } from '@element-plus/icons-vue'
import IconToolbox from '@/shared/components/icons/iconToolbox.vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'

const props = defineProps({
  app_active_tab: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['select'])
const layoutStore = useLayoutStore()

const handleNav = (tab) => {
  emit('select', tab)
}
</script>

<style scoped>
.mobile-menu {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  min-height: 50px;
  background: rgba(var(--el-bg-color-rgb), 0.8);
  backdrop-filter: blur(15px);
  -webkit-backdrop-filter: blur(15px);
  display: flex;
  justify-content: space-around;
  align-items: center;
  border-top: 0.5px solid var(--app-border-refined);
  z-index: var(--z-index-fixed);
  padding-bottom: calc(2px + env(safe-area-inset-bottom));
  padding-top: 8px;
  -webkit-tap-highlight-color: transparent;
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  flex: 1;
  -webkit-tap-highlight-color: transparent;
}

.nav-item span {
  font-size: 11px;
}

.nav-item.active {
  color: var(--el-color-primary);
  transform: translateY(-2px);
}

.nav-item.active .el-icon {
  transform: scale(1.1);
}

/* 适配深色模式 */
:deep(html.dark) .mobile-menu {
  background: rgba(20, 20, 20, 0.8);
}
</style>
