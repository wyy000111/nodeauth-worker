<template>
  <header class="header" :class="{ 'is-mobile-subpage': layoutStore.isMobile && layoutStore.canGoBack }">
    <!-- Left: Logo or Back Button -->
    <div class="header-left">
      <el-button 
        v-if="layoutStore.isMobile && layoutStore.canGoBack" 
        circle 
        link 
        :icon="ArrowLeft" 
        @click="layoutStore.goBack()" 
        class="header-back-btn"
      />
      <a 
        href="#" 
        @click.prevent="goHome" 
        class="header-home-link" 
        v-if="!layoutStore.isMobile || !layoutStore.canGoBack"
      >
        <div class="header-logo" @click="layoutStore.resetHomeTab">
          <img src="/logo.svg?20260402" alt="NodeAuth" class="header-logo-img" />
          <h2 class="header-logo-text">NodeAuth</h2>
          
          <!-- 核心状态 Tag 注入 -->
          <transition name="tag-fade">
            <el-tag
              v-if="layoutStore.isManualOffline"
              size="small"
              type="primary"
              effect="plain"
              class="status-tag manual-offline"
            >
              {{ $t('common.offline_tag') }}
            </el-tag>
            <el-tag
              v-else-if="layoutStore.isPhysicalOffline"
              size="small"
              type="warning"
              effect="plain"
              class="status-tag passive-offline"
            >
              {{ $t('common.network_error_tag') }}
            </el-tag>
          </transition>
        </div>
      </a>
    </div>

    <!-- Center: Page Title (Mobile Only) -->
    <div class="header-center" v-if="layoutStore.isMobile && layoutStore.canGoBack">
      <h2 class="header-page-title">
        {{ layoutStore.activeSubTool ? $t(toolTitles[layoutStore.activeSubTool]) : $t(tabTitles[layoutStore.app_active_tab]) }}
      </h2>
    </div>

    <!-- Right: Actions -->
    <div class="header-right">
      <!-- 访客页面 -->
      <div class="guest-actions" v-if="!route.meta.requiresAuth">
        <el-button circle :icon="themeStore.isDark ? Sunny : Moon" @click="themeStore.toggleTheme" class="header-action-btn" />
        <el-button circle :icon="iconLocales" :title="$i18n.locale === 'zh-CN' ? 'English' : '切换语言'" @click="toggleLanguage" class="header-action-btn" />
      </div>

      <!-- 搜索输入框 (移动端展开态) -->
      <div class="mobile-search-wrapper" v-if="layoutStore.isMobile && layoutStore.isSearchVisible">
        <el-input
          v-model="layoutStore.searchQuery"
          :placeholder="$t('search.placeholder')"
          clearable
          class="header-search-input"
        >
          <template #prefix>
            <el-icon v-if="layoutStore.isLoadingSearching && layoutStore.searchQuery" class="is-loading"><Loading /></el-icon>
            <el-icon v-else><Search /></el-icon>
          </template>
        </el-input>
        <el-button link @click="layoutStore.toggleSearch(false)" class="search-cancel-btn">
          {{ $t('common.cancel') }}
        </el-button>
      </div>

      <!-- 移动端：功能按钮组 (仅在账号列表页显示) -->
      <div class="mobile-actions" v-if="layoutStore.isMobile && route.meta.requiresAuth && layoutStore.app_active_tab === 'vault' && !layoutStore.isSearchVisible">
        <el-button 
          circle 
          @click="layoutStore.toggleSearch(true)" 
          class="header-action-btn shadow-btn"
        >
          <el-icon v-if="layoutStore.isLoadingSearching" class="is-loading"><Loading /></el-icon>
          <el-icon v-else><Search /></el-icon>
        </el-button>
        <el-button 
          circle 
          type="primary" 
          :icon="Plus" 
          @click="layoutStore.setActiveTab('add-vault')" 
          class="header-add-btn shadow-btn"
        />
      </div>

      <!-- 系统内部页面，仅 PC 端显示用户头像 -->
      <div class="user-profile" v-if="!layoutStore.isMobile && route.meta.requiresAuth">
        <el-avatar 
          :size="32" 
          :src="authUserStore.userInfo?.avatar || ''"
          @error="(e) => true"
        >
          {{ authUserStore.userInfo?.username ? authUserStore.userInfo.username.charAt(0).toUpperCase() : '?' }}
        </el-avatar>
        <span class="username">{{ authUserStore.userInfo?.username || 'NodeAuth' }}</span>
      </div>
    </div>
  </header>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router'
import { Plus, Search, Sunny, Moon, Loading, ArrowLeft } from '@element-plus/icons-vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { useThemeStore } from '@/shared/stores/themeStore'
import iconLocales from '@/shared/components/icons/iconLocales.vue'
import { useI18n } from 'vue-i18n'
import { setLanguage } from '@/locales'

const { locale } = useI18n()
const route = useRoute()
const router = useRouter()
const layoutStore = useLayoutStore()
const authUserStore = useAuthUserStore()
const themeStore = useThemeStore()

const tabTitles = {
  'vault': 'menu.vault',
  'add-vault': 'menu.add',
  'mobile-data': 'menu.migration',
  'mobile-settings': 'menu.settings',
  'settings-appearance': 'menu.appearance',
  'migration-export': 'migration.export',
  'migration-import': 'migration.import',
  'backups': 'menu.backup',
  'tools': 'menu.tools',
  'settings-passkey': 'menu.passkey',
  'settings-about': 'menu.about',
  'settings-language': 'menu.language',
  'settings-theme': 'menu.theme',
  'settings-layout': 'settings.display_layout',
  'settings-security': 'menu.security',
  'settings-devices': 'security.devices'
}

const toggleLanguage = () => {
  const targetLang = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN'
  setLanguage(targetLang)
}

const goHome = () => {
  if (route.path === '/') {
    layoutStore.homeTabReset++
  } else {
    router.push('/')
  }
}

const toolTitles = {
  'totp-secret': 'tools.totp_secret_title',
  'apps-review': 'tools.apps_review_title',
  'password': 'tools.password_gen_title',
  'time-sync': 'tools.time_sync_title',
  'qr-parser': 'tools.qr_parser_title'
}
</script>