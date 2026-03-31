<template>
  <div class="tools-wrapper">
    <div class="tab-card-wrapper">
      <div class="page-header-container">
        <template v-if="!currentTool">
          <div class="page-header-hero">
            <div class="hero-icon-wrapper">
              <el-icon :size="28"><Toolbox /></el-icon>
            </div>
            <h2 v-if="!layoutStore.isMobile">{{ $t('tools.title') }}</h2>
          </div>
          <p class="page-desc-text">{{ $t('tools.desc') }}</p>
        </template>
        <template v-else>
          <div class="page-header-hero">
            <div class="hero-icon-wrapper">
              <el-icon :size="28"><component :is="getToolIcon(currentTool)" /></el-icon>
            </div>
            <h2 v-if="!layoutStore.isMobile">{{ getToolTitle(currentTool) }}</h2>
          </div>
          <p class="page-desc-text">{{ getToolDesc(currentTool) }}</p>
        </template>
      </div>

      <!-- 工具列表 (卡片视图) -->
      <div v-if="!currentTool" class="tools-grid">
        <el-card 
          v-for="tool in tools" 
          :key="tool.id" 
          shadow="hover" 
          :class="['tool-card', `tool-card-${tool.id}`]" 
          @click="currentTool = tool.id"
        >
          <div class="tool-card-content">
            <div class="icon-wrapper">
              <el-icon :size="32"><component :is="tool.icon" /></el-icon>
            </div>
            <div class="text-info">
              <h3>{{ tool.title }}</h3>
              <p>{{ tool.desc }}</p>
            </div>
          </div>
        </el-card>
      </div>

      <!-- 具体工具内容 -->
      <div v-else class="tool-container">
        
        <!-- 动态组件加载 -->
        <component :is="activeComponent" />

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, defineAsyncComponent, markRaw } from 'vue'
import { 
  Key, Timer, Lock, Camera, Iphone 
} from '@element-plus/icons-vue'
import Toolbox from '@/shared/components/icons/iconToolbox.vue'
import { i18n } from '@/locales'
import { useLayoutStore } from '@/features/home/store/layoutStore'

const layoutStore = useLayoutStore()
const ToolPassword = defineAsyncComponent(() => import('@/features/tools/components/passwordGenerator.vue'))
const ToolTimeSync = defineAsyncComponent(() => import('@/features/tools/components/timeSync.vue'))
const ToolQrParser = defineAsyncComponent(() => import('@/features/tools/components/qrParser.vue'))
const ToolTotpSecret = defineAsyncComponent(() => import('@/features/tools/components/totpSecret.vue'))
const ToolAppsReview = defineAsyncComponent(() => import('@/features/tools/components/appsReview.vue'))

const currentTool = computed({
  get: () => layoutStore.activeSubTool,
  set: (val) => { layoutStore.activeSubTool = val }
})

const { t } = i18n.global

const tools = computed(() => [
  { 
    id: 'totp-secret', 
    title: t('tools.totp_secret_title'), 
    desc: t('tools.totp_secret_desc'), 
    icon: markRaw(Lock)
  },
  {
    id: 'apps-review',
    title: t('tools.apps_review_title'),
    desc: t('tools.apps_review_desc'),
    icon: markRaw(Iphone)
  },
  { 
    id: 'password', 
    title: t('tools.password_gen_title'), 
    desc: t('tools.password_gen_desc'), 
    icon: markRaw(Key)
  },
  {
    id: 'time-sync',
    title: t('tools.time_sync_title'),
    desc: t('tools.time_sync_desc'),
    icon: markRaw(Timer)
  },
  {
    id: 'qr-parser',
    title: t('tools.qr_parser_title'),
    desc: t('tools.qr_parser_desc'),
    icon: markRaw(Camera)
  }
])

const getToolTitle = (id) => {
  const t = tools.value.find(tool => tool.id === id)
  return t ? t.title : '工具'
}

const getToolDesc = (id) => {
  const t = tools.value.find(tool => tool.id === id)
  return t ? t.desc : ''
}

const getToolIcon = (id) => {
  const t = tools.value.find(tool => tool.id === id)
  return t ? t.icon : Toolbox
}

const activeComponent = computed(() => {
  switch (currentTool.value) {
    case 'password': return ToolPassword;
    case 'time-sync': return ToolTimeSync;
    case 'qr-parser': return ToolQrParser;
    case 'totp-secret': return ToolTotpSecret;
    case 'apps-review': return ToolAppsReview;
    default: return null
  }
})
</script>
