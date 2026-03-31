<template>
  <div class="settings-theme-wrapper">
    <div class="tab-card-wrapper">
      <div class="page-header-container">
        <div class="page-header-hero">
          <div class="hero-icon-wrapper">
            <el-icon :size="28"><component :is="IconTheme" /></el-icon>
          </div>
          <h2 v-if="!layoutStore.isMobile">{{ $t('menu.theme') }}</h2>
        </div>
        <p class="page-desc-text">{{ $t('settings.theme_desc') }}</p>
      </div>

      <div class="theme-grid">
        <!-- 自动模式 -->
        <el-card 
          shadow="hover" 
          :class="['theme-card auto-mode', { active: themeStore.themeMode === 'auto' }]"
          @click="themeStore.setThemeMode('auto')"
        >
          <div class="theme-preview auto">
            <div class="preview-split">
              <div class="split-light"></div>
              <div class="split-dark"></div>
            </div>
          </div>
          <div class="theme-info">
            <el-icon><Monitor /></el-icon>
            <span>{{ $t('theme.auto') }}</span>
          </div>
        </el-card>

        <!-- 浅色模式 -->
        <el-card 
          shadow="hover" 
          :class="['theme-card light-mode', { active: themeStore.themeMode === 'light' }]"
          @click="themeStore.setThemeMode('light')"
        >
          <div class="theme-preview light">
            <div class="preview-header"></div>
            <div class="preview-content">
              <div class="preview-item"></div>
              <div class="preview-item"></div>
            </div>
          </div>
          <div class="theme-info">
            <el-icon><Sunny /></el-icon>
            <span>{{ $t('theme.light') }}</span>
          </div>
        </el-card>

        <!-- 深色模式 -->
        <el-card 
          shadow="hover" 
          :class="['theme-card dark-mode', { active: themeStore.themeMode === 'dark' }]"
          @click="themeStore.setThemeMode('dark')"
        >
          <div class="theme-preview dark">
            <div class="preview-header"></div>
            <div class="preview-content">
              <div class="preview-item"></div>
              <div class="preview-item"></div>
            </div>
          </div>
          <div class="theme-info">
            <el-icon><Moon /></el-icon>
            <span>{{ $t('theme.dark') }}</span>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useThemeStore } from '@/shared/stores/themeStore'
import { Sunny, Moon, Monitor } from '@element-plus/icons-vue'
import IconTheme from '@/shared/components/icons/iconTheme.vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'

const themeStore = useThemeStore()
const layoutStore = useLayoutStore()
</script>
