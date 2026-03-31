<template>
  <div class="tool-pane">
    <div class="time-sync-container">
      <!-- 状态横幅 (重构后左对齐流线设计) -->
      <div v-if="syncStatus" class="custom-status-banner mb-20" :class="`banner-${syncStatus.type}`">
        <div class="banner-icon">
          <el-icon v-if="syncStatus.type === 'success'"><CircleCheckFilled /></el-icon>
          <el-icon v-else-if="syncStatus.type === 'warning'"><WarningFilled /></el-icon>
          <el-icon v-else><CircleCloseFilled /></el-icon>
        </div>
        <div class="banner-content">
          <div class="banner-title">{{ syncStatus.title }}</div>
          <div class="banner-desc">{{ syncStatus.desc }}</div>
        </div>
      </div>

      <!-- 时钟仪表盘 -->
      <div class="clocks-wrapper">
        <div class="clock-card local">
          <div class="clock-label">📱 {{ $t('tools.local_time') }}</div>
          <div class="clock-time">{{ formatTime(localTime) }}</div>
        </div>
        <div class="clock-card server">
          <div class="clock-label">☁️ {{ $t('tools.server_time') }}</div>
          <div class="clock-time">{{ formatTime(serverTime) }}</div>
        </div>
      </div>

      <!-- 详细数据 (数据胶囊底座) -->
      <div class="metrics-pill-container">
        <div class="metric-pill">
          <el-icon class="metric-icon"><Timer /></el-icon>
          <span class="metric-label">{{ $t('tools.time_offset') }}</span>
          <span class="metric-value">{{ offset !== null ? `${offset > 0 ? '+' : ''}${offset} ms` : '--' }}</span>
        </div>
        <div class="metric-divider"></div>
        <div class="metric-pill">
          <el-icon class="metric-icon"><Connection /></el-icon>
          <span class="metric-label">{{ $t('tools.network_latency') }}</span>
          <span class="metric-value">{{ rtt !== null ? `${rtt} ms` : '--' }}</span>
        </div>
      </div>

      <el-button type="primary" size="large" :loading="isSyncing" @click="syncTime" class="w-full mt-20">
        <el-icon><Refresh /></el-icon> {{ $t('tools.check_now') }}
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, CircleCheckFilled, WarningFilled, CircleCloseFilled, Timer, Connection } from '@element-plus/icons-vue'
import { useTimeSync } from '@/features/tools/composables/useTimeSync'
import { i18n } from '@/locales'

const {
  localTime,
  serverTime,
  offset,
  rtt,
  isSyncing,
  syncStatus,
  syncTime: _syncTime
} = useTimeSync()

const formatTime = (ts) => new Date(ts).toLocaleTimeString()
const { t } = i18n.global

const syncTime = async () => {
  const result = await _syncTime()
  if (result.success) {
    ElMessage.success(t('tools.sync_completed', { offset: result.offset }))
  } else {
    ElMessage.error(result.error?.message || t('api_errors.request_failed'))
  }
}

onMounted(() => {
  syncTime()
})
</script>