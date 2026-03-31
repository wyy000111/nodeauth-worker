<template>
  <div class="settings-layout-wrapper">
    <div class="tab-card-wrapper">
      <div class="page-header-container">
        <div class="page-header-hero">
          <div class="hero-icon-wrapper">
            <el-icon :size="28"><Grid /></el-icon>
          </div>
          <h2 v-if="!layoutStore.isMobile">{{ $t('settings.display_layout') }}</h2>
        </div>
        <p class="page-desc-text">{{ $t('settings.layout_desc') }}</p>
      </div>

      <div class="layout-grid">
        <!-- 标准卡片 -->
        <el-card 
          shadow="hover" 
          :class="['layout-card', { active: layoutStore.appVaultViewMode === 'card' }]"
          @click="layoutStore.setVaultViewMode('card')"
        >
          <div class="layout-preview card-mode">
            <div class="preview-item"></div>
            <div class="preview-item"></div>
          </div>
          <div class="layout-info">
            <el-icon><Grid /></el-icon>
            <span>{{ $t('settings.layout_standard') }}</span>
          </div>
        </el-card>

        <!-- 紧凑列表 -->
        <el-card 
          shadow="hover" 
          :class="['layout-card', { active: layoutStore.appVaultViewMode === 'compact' }]"
          @click="layoutStore.setVaultViewMode('compact')"
        >
          <div class="layout-preview compact-mode">
            <div class="preview-line"></div>
            <div class="preview-line"></div>
            <div class="preview-line"></div>
          </div>
          <div class="layout-info">
            <el-icon><Expand /></el-icon>
            <span>{{ $t('settings.layout_compact') }}</span>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { Grid, Expand } from '@element-plus/icons-vue'

const layoutStore = useLayoutStore()
</script>

<style scoped>
.settings-layout-wrapper {
  padding: 24px 0px;
}

.layout-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.layout-card {
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.3s;
  border-radius: var(--app-radius-card);
}

.layout-card.active {
  border: 2px solid var(--el-color-primary) !important;
  background-color: var(--el-color-primary-light-9) !important;
  box-shadow: 0 0 0 1px var(--el-color-primary);
}

.layout-preview {
  height: 100px;
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
  margin-bottom: 15px;
  padding: 15px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-mode .preview-item {
  height: 100%;
  background: var(--app-card-bg);
  border-radius: 6px;
  border: 1px solid var(--el-border-color-lighter);
}

.compact-mode .preview-line {
  height: 20px;
  background: var(--app-card-bg);
  border-radius: 4px;
  border: 1px solid var(--el-border-color-lighter);
}

.layout-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-weight: 600;
}

.layout-info .el-icon {
  color: var(--el-color-primary);
}
</style>
