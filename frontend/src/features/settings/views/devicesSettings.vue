<template>
  <div class="device-management-view">
    <div class="page-header-container">
      <div class="page-header-hero">
        <div class="hero-icon-wrapper">
          <el-icon :size="28"><Monitor /></el-icon>
        </div>
        <h2>{{ $t('security.devices') }}</h2>
      </div>
      <p class="page-desc-text">{{ $t('security.devices_desc') }}</p>
    </div>

    <div class="device-header-actions" v-if="sessions.length > 1">
      <el-button 
        type="danger" 
        class="sign-out-all-btn"
        @click="confirmSignoutAll"
        :loading="actionLoading"
        :disabled="layoutStore.isOffline"
      >
        <el-icon class="el-icon--left"><Warning /></el-icon>
        {{ $t('security.sign_out_all_others') }}
      </el-button>
    </div>

    <div class="device-list-container" v-loading="loading">
      <el-empty 
        v-if="!loading && sessions.length === 0" 
        :description="$t('common.no_data')" 
      />
      
      <div 
        v-for="session in sessions" 
        :key="session.id" 
        class="session-item"
        :class="{ 'is-current': session.isCurrent }"
      >
        <div class="session-info-left">
          <el-icon class="device-icon" :size="32">
            <component :is="getDeviceIcon(session.deviceType)" />
          </el-icon>
          <div class="session-details">
            <div class="session-name-row">
              <el-tooltip
                :content="session.deviceType"
                placement="top"
                :show-after="500"
                effect="dark"
              >
                <span class="device-name">{{ session.friendlyName || $t('security.unknown_device') }}</span>
              </el-tooltip>
            </div>

            <!-- 🛡️ 架构师升级：按照图示层级排列 -->
            <div class="session-status-row" v-if="session.isCurrent">
               <el-tag 
                size="small" 
                type="success" 
                effect="light" 
                class="current-badge-inline"
              >
                {{ $t('security.current_device') }}
              </el-tag>
            </div>

            <div class="session-account-info" v-if="session.userId || session.provider">
              <span class="info-provider" v-if="session.provider">
                {{ formatProvider(session.provider) }} 
              </span>
              <span class="info-user" v-if="session.userId">
                @ {{ session.userId }}
              </span>
            </div>

            <div class="session-meta">
              <span class="meta-item">
                <el-icon><Location /></el-icon>
                {{ session.ipAddress }}
              </span>
              <span class="meta-item">
                <el-icon><Clock /></el-icon>
                {{ formatTime(session.lastActiveAt) }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="!session.isCurrent" class="session-action-right">
          <el-button
            class="remove-btn"
            type="danger"
            text
            @click="confirmRemoveSession(session)"
            :disabled="actionLoading || layoutStore.isOffline"
          >
            {{ $t('common.remove') }}
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { sessionService } from '@/features/auth/service/sessionService'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { Monitor, Warning, Location, Clock, Iphone, Platform } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const { t } = useI18n()
const layoutStore = useLayoutStore()

const sessions = ref([])
const loading = ref(true)
const actionLoading = ref(false)

const loadSessions = async () => {
  loading.value = true
  try {
    const res = await sessionService.getSessions()
    if (res.success) {
      // 排序: 当前设备优先, 其余按活跃时间倒序
      const sorted = res.sessions.sort((a, b) => {
        if (a.isCurrent) return -1
        if (b.isCurrent) return 1
        return b.lastActiveAt - a.lastActiveAt
      })
      sessions.value = sorted
    }
  } catch (error) {
    handleError(error)
  } finally {
    loading.value = false
  }
}

const confirmRemoveSession = (session) => {
  if (session.isCurrent) {
    ElMessage.error(t('security.cannot_remove_current'))
    return
  }

  ElMessageBox.confirm(
    t('security.confirm_remove_device_desc', { device: session.friendlyName }),
    t('security.confirm_remove_device'),
    {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
      customClass: 'danger-confirm-dialog'
    }
  ).then(async () => {
    actionLoading.value = true
    try {
      const res = await sessionService.deleteSession(session.id)
      if (res && res.success !== false) {
        ElMessage.success(t('common.success'))
        sessions.value = sessions.value.filter(s => s.id !== session.id)
      }
    } catch (error) {
      if (error && error.status === 400) {
        ElMessage.error(t('security.cannot_remove_current'))
      } else {
        handleError(error)
      }
    } finally {
      actionLoading.value = false
    }
  }).catch(() => {})
}

const confirmSignoutAll = () => {
  ElMessageBox.confirm(
    t('security.confirm_signout_all_desc'),
    t('security.sign_out_all_others'),
    {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      type: 'error',
      customClass: 'danger-confirm-dialog'
    }
  ).then(async () => {
    actionLoading.value = true
    try {
      const res = await sessionService.deleteAllOtherSessions()
      if (res && res.success !== false) {
        ElMessage.success(t('common.success'))
        sessions.value = sessions.value.filter(s => s.isCurrent)
      }
    } catch (error) {
      handleError(error)
    } finally {
      actionLoading.value = false
    }
  }).catch(() => {})
}

const handleError = (error) => {
  if (error && error.status === 401) {
    // 幽灵 JWT 或身份失效，重定向登录
    ElMessage.error(t('auth.session_expired'))
    router.push('/login')
  } else {
    ElMessage.error(error.message || t('api_errors.network_error'))
  }
}

const getDeviceIcon = (deviceType) => {
  const dt = (deviceType || '').toLowerCase()
  if (dt.includes('iphone') || dt.includes('android') || dt.includes('mobile')) return Iphone
  if (dt.includes('mac') || dt.includes('windows') || dt.includes('linux')) return Monitor
  return Platform
}

const formatTime = (timestamp) => {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleString()
}

const formatProvider = (provider) => {
  if (!provider) return ''
  const p = provider.toLowerCase()
  const map = {
    'github': 'GitHub',
    'telegram': 'Telegram',
    'passkey': t('menu.passkey'),
    'web3': 'Web3 Wallet',
    'google': 'Google',
    'discord': 'Discord'
  }
  return map[p] || provider
}

onMounted(() => {
  loadSessions()
})
</script>

<style scoped>
</style>
