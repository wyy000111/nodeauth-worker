<template>
  <el-aside :width="isCollapse ? '64px' : '240px'" class="left-aside">
    <el-menu
      :default-active="app_active_tab"
      class="side-menu"
      @select="$emit('select', $event)"
      :collapse="isCollapse"
    >
      <template v-for="item in menuItems" :key="item.key">
        <!-- 有子菜单的情况 -->
        <el-sub-menu v-if="item.children" :index="item.key">
          <template #title>
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ $t(item.label) }}</span>
          </template>
          <el-menu-item 
            v-for="sub in item.children" 
            :key="sub.key" 
            :index="sub.key"
          >
            <el-icon><component :is="sub.icon" /></el-icon>
            <span>{{ $t(sub.label) }}</span>
          </el-menu-item>
        </el-sub-menu>

        <!-- 普通菜单项 -->
        <el-menu-item v-else :index="item.key">
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title>
            <span>{{ $t(item.label) }}</span>
          </template>
        </el-menu-item>
      </template>
    </el-menu>

    <!-- 底部操作按钮 -->
    <div class="sidebar-footer" :class="{ 'is-collapsed': isCollapse }">
      <el-button 
        circle 
        :icon="isCollapse ? Expand : Fold" 
        @click="toggleCollapse" 
        :title="isCollapse ? '展开' : '折叠'" 
      />
      <el-button 
        circle 
        @click="handleLogout" 
        :title="$t('menu.logout')"
      >
        <el-icon><SwitchButton /></el-icon>
      </el-button>
    </div>
  </el-aside>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { 
  SwitchButton, Fold, Expand 
} from '@element-plus/icons-vue'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { useI18n } from 'vue-i18n'
import { setLanguage } from '@/locales'
import { menuItems } from '@/features/home/constants/navigation'

const { t, locale } = useI18n()
const authUserStore = useAuthUserStore()
const layoutStore = useLayoutStore()
const router = useRouter()

const props = defineProps({
  app_active_tab: {
    type: String,
    required: true
  }
})

defineEmits(['select'])

// --- 折叠逻辑 ---
const isCollapse = computed(() => layoutStore.isSidebarCollapsed)
const toggleCollapse = () => layoutStore.toggleSidebar()

// --- 退出登录 ---
const handleLogout = async () => {
  await authUserStore.clearUserInfo()
  await Promise.race([
    authUserStore.logout(),
    new Promise(resolve => setTimeout(resolve, 1500))
  ]).catch(() => {})
  window.location.href = '/login'
  ElMessage.success(t('auth.logout_success'))
}
</script>
