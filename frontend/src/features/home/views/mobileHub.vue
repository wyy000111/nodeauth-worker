<template>
  <div class="mobile-hub-container">
    <!-- 数据中心 Header (仅在数据页展示) -->
    <div class="page-header-container" v-if="mode === 'data'">
      <div class="page-header-hero">
        <div class="hero-icon-wrapper">
          <el-icon :size="28"><Coin /></el-icon>
        </div>
      </div>
      <p class="page-desc-text">{{ $t('migration.hub_desc') }}</p>
    </div>

    <!-- 移动端个人中心 Header (仅在设置页展示) -->
    <div class="user-profile-header" v-if="mode === 'settings' && authUserStore.userInfo">
      <el-avatar 
        :size="72" 
        :src="authUserStore.userInfo?.avatar || '/favicon.svg?20260330'" 
        class="profile-avatar"
        :class="{ 'is-logo': !authUserStore.userInfo?.avatar }"
        @error="(e) => true"
      >
        <img src="/logo.svg?20260332" alt="NodeAuth" />
      </el-avatar>
      <div class="profile-info">
        <div class="profile-name-row">
          <span class="profile-name">{{ formattedUsername }}</span>
          <i class="status-dot" :class="{ 'is-online': !layoutStore.isOffline }"></i>
        </div>
        <div class="profile-provider" v-if="authUserStore.userInfo?.provider">
          {{ authUserStore.userInfo?.provider }}
        </div>
      </div>
    </div>

    <div class="hub-list">
      <div 
        v-for="item in items" 
        :key="item.tab" 
        class="hub-item"
        @click="handleSelect(item.tab)"
      >
        <div class="hub-item-left flex-1">
          <el-icon :size="20">
            <component :is="item.icon" />
          </el-icon>
          <div class="hub-item-info">
            <span class="hub-item-title">{{ item.title }}</span>
            <span class="hub-item-desc" v-if="item.desc">{{ item.desc }}</span>
          </div>
        </div>
        <el-icon class="hub-item-arrow"><ArrowRight /></el-icon>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { 
  Download, Upload, Cloudy, Coin, SwitchButton,
  ArrowRight, Lock, MagicStick
} from '@element-plus/icons-vue'
import Fingerprint from '@/shared/components/icons/iconFingerprint.vue'
import IconAbout from '@/shared/components/icons/iconAbout.vue'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { ElMessageBox, ElMessage } from 'element-plus'

const { t } = useI18n()
const authUserStore = useAuthUserStore()
const layoutStore = useLayoutStore()

const props = defineProps({
  mode: {
    type: String,
    required: true,
    validator: (val) => ['data', 'settings'].includes(val)
  }
})

const emit = defineEmits(['select'])

const title = computed(() => {
  return props.mode === 'data' ? t('menu.migration') : t('menu.settings')
})

const formattedUsername = computed(() => {
  const user = authUserStore.userInfo
  if (!user) return 'NodeAuth'
  
  if (user.provider?.toUpperCase() === 'WEB3' && user.username?.length > 10) {
    const name = user.username
    return `${name.substring(0, 4)}***${name.substring(name.length - 4)}`
  }
  
  return user.username || 'NodeAuth'
})

const items = computed(() => {
  if (props.mode === 'data') {
    return [
      { 
        title: t('migration.export'), 
        desc: t('migration.export_desc'),
        icon: Download, 
        tab: 'migration-export' 
      },
      { 
        title: t('migration.import'), 
        desc: t('migration.import_desc'),
        icon: Upload, 
        tab: 'migration-import' 
      },
      { 
        title: t('menu.backup'), 
        desc: t('backup.center_desc'),
        icon: Cloudy, 
        tab: 'backups' 
      }
    ]
  } else {
    return [
      { 
        title: t('menu.passkey'), 
        icon: Fingerprint, 
        tab: 'settings-passkey' 
      },
      { 
        title: t('menu.security'), 
        icon: Lock, 
        tab: 'settings-security' 
      },
      { 
        title: t('menu.appearance'), 
        icon: MagicStick, 
        tab: 'settings-appearance' 
      },
      { 
        title: t('menu.about'), 
        icon: IconAbout, 
        tab: 'settings-about' 
      },
      { 
        title: t('menu.logout'), 
        icon: SwitchButton, 
        tab: 'logout' 
      }
    ]
  }
})

const handleSelect = async (tab) => {
  if (tab === 'logout') {
    try {
      await ElMessageBox.confirm(
        t('auth.logout_confirm'),
        t('common.tip'),
        {
          confirmButtonText: t('common.confirm'),
          cancelButtonText: t('common.cancel'),
          type: 'warning',
          roundButton: true
        }
      )
      
      // 1. 立即清空本地状态
      await authUserStore.clearUserInfo()
      
      // 2. 异步注销流程 (带超时保护)
      await Promise.race([
        authUserStore.logout(),
        new Promise(resolve => setTimeout(resolve, 1500))
      ]).catch(() => {})
      
      // 3. 跳转登录页
      window.location.href = '/login'
      ElMessage.success(t('auth.logout_success'))
      
    } catch (e) {
      // User cancelled
    }
    return
  }
  emit('select', tab)
}
</script>
