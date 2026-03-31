<template>
  <div class="appearance-settings-view">
    <div class="page-header-container">
      <div class="page-header-hero">
        <div class="hero-icon-wrapper">
          <el-icon :size="28"><MagicStick /></el-icon>
        </div>
        <h2>{{ $t('menu.appearance') }}</h2>
      </div>
      <p class="page-desc-text">{{ $t('settings.appearance_desc') }}</p>
    </div>

    <div class="appearance-grid">
      <!-- 列表布局 -->
      <el-card 
        class="setting-item-card clickable-card" 
        shadow="never"
        @click="handleNav('settings-layout')"
      >
        <div class="setting-item-content">
          <div class="setting-item-left">
            <el-icon><Grid /></el-icon>
            <div class="setting-item-info">
              <span class="setting-title">{{ $t('settings.display_layout') }}</span>
              <span class="setting-desc">{{ $t('settings.layout_desc') }}</span>
            </div>
          </div>
          <el-icon class="card-arrow"><ArrowRight /></el-icon>
        </div>
      </el-card>

      <!-- 主题模式 -->
      <el-card 
        class="setting-item-card clickable-card" 
        shadow="never"
        @click="handleNav('settings-theme')"
      >
        <div class="setting-item-content">
          <div class="setting-item-left">
            <el-icon><IconTheme /></el-icon>
            <div class="setting-item-info">
              <span class="setting-title">{{ $t('menu.theme') }}</span>
              <span class="setting-desc">{{ $t('settings.theme_desc') }}</span>
            </div>
          </div>
          <el-icon class="card-arrow"><ArrowRight /></el-icon>
        </div>
      </el-card>

      <!-- 语言切换 -->
      <el-card 
        class="setting-item-card clickable-card" 
        shadow="never"
        @click="handleNav('settings-language')"
      >
        <div class="setting-item-content">
          <div class="setting-item-left">
            <el-icon><IconLocales /></el-icon>
            <div class="setting-item-info">
              <span class="setting-title">{{ $t('menu.language') }}</span>
              <span class="setting-desc">{{ $t('settings.language_desc') }}</span>
            </div>
          </div>
          <el-icon class="card-arrow"><ArrowRight /></el-icon>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { MagicStick, Grid, ArrowRight } from '@element-plus/icons-vue'
import IconLocales from '@/shared/components/icons/iconLocales.vue'
import IconTheme from '@/shared/components/icons/iconTheme.vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'

const layoutStore = useLayoutStore()

const handleNav = (tab) => {
  layoutStore.app_active_tab = tab
}
</script>

<style scoped>
</style>
