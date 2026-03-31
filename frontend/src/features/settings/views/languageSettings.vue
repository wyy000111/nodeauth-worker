<template>
  <div class="settings-language-wrapper">
    <div class="tab-card-wrapper">
      <div class="page-header-container">
        <div class="page-header-hero">
          <div class="hero-icon-wrapper">
            <el-icon :size="28"><component :is="IconLocales" /></el-icon>
          </div>
          <h2 v-if="!layoutStore.isMobile">{{ $t('menu.language') }}</h2>
        </div>
        <p class="page-desc-text">{{ $t('settings.language_desc') }}</p>
      </div>

      <div class="language-grid">
        <el-card 
          v-for="lang in languages" 
          :key="lang.code" 
          shadow="hover" 
          :class="['language-card', { active: i18n.global.locale.value === lang.code }]"
          @click="changeLanguage(lang.code)"
        >
          <div class="lang-card-content">
            <span class="lang-flag">{{ lang.flag }}</span>
            <div class="lang-info">
              <span class="lang-name">{{ lang.name }}</span>
              <span class="lang-native">{{ lang.nativeName }}</span>
            </div>
            <el-icon v-if="i18n.global.locale.value === lang.code" class="check-icon">
              <CircleCheckFilled />
            </el-icon>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { i18n, setLanguage } from '@/locales'
import { CircleCheckFilled } from '@element-plus/icons-vue'
import IconLocales from '@/shared/components/icons/iconLocales.vue'
import { ElMessage } from 'element-plus'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { useI18n } from 'vue-i18n'

const layoutStore = useLayoutStore()
const { t } = useI18n()

const languages = [
  { code: 'zh-CN', name: '简体中文', nativeName: 'Chinese', flag: '🇨🇳' },
  { code: 'en-US', name: 'English', nativeName: 'English', flag: '🇺🇸' }
]

const changeLanguage = (code) => {
  setLanguage(code)
}
</script>
