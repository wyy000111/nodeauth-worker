<script setup>
import { onMounted } from 'vue'
import { Check, Download, Warning, Loading, CircleCheck } from '@element-plus/icons-vue'
import { useOfflineReadiness } from '../composables/useOfflineReadiness'
import ResponsiveOverlay from '@/shared/components/responsiveOverlay.vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'

const props = defineProps({
    modelValue: {
        type: Boolean,
        default: false
    }
})

const emit = defineEmits(['update:modelValue', 'confirm'])
const layoutStore = useLayoutStore()

const {
    status,
    overallProgress,
    isDownloading,
    canEnableOffline,
    checkAll,
    downloadResources,
    startMonitor,
    stopMonitor
} = useOfflineReadiness()

watch(() => props.modelValue, (newVal) => {
    if (newVal) {
        startMonitor()
    } else {
        stopMonitor()
    }
})

const handleClose = () => {
    emit('update:modelValue', false)
}

const handleConfirm = () => {
    if (canEnableOffline.value) {
        emit('confirm')
        handleClose()
    }
}

const getStatusType = (val) => {
    if (val === 100) return 'success'
    if (val > 0) return 'warning'
    return '' // Fix: Element Plus el-progress 'status' does not support 'info'
}

</script>

<template>
  <ResponsiveOverlay
    :model-value="modelValue"
    @update:model-value="handleClose"
    :title="$t('security.offline_check_title') || '离线就绪准备度检测 (Air-Gapped Readiness)'"
    width="520px"
  >
    <div class="readiness-body">
      <div class="overall-header">
        <div class="circle-container">
            <el-progress 
                type="circle" 
                :percentage="overallProgress" 
                :status="overallProgress === 100 ? 'success' : ''"
                :stroke-width="10"
                :width="layoutStore.isMobile ? 80 : 100"
            >
                <template #default="{ percentage }">
                    <div class="progress-text">
                        <span class="percentage">{{ percentage }}%</span>
                        <span class="label">{{ $t('security.ready_label') || '就绪' }}</span>
                    </div>
                </template>
            </el-progress>
        </div>
        <div class="header-info">
             <h4>{{ $t('security.offline_check_desc') }}</h4>
             <p v-if="overallProgress < 100" class="text-warning">
                <el-icon><Warning /></el-icon> 
                <span>{{ $t('security.offline_incomplete_msg') }}</span>
             </p>
             <p v-else class="text-success">
                <el-icon><CircleCheck /></el-icon> 
                <span>{{ $t('security.offline_complete_msg') }}</span>
             </p>
        </div>
      </div>

      <el-divider />

      <div class="check-list">
        <template v-for="(val, label) in {
            accounts: $t('security.check_accounts'),
            components: $t('security.check_components'),
            engine: $t('security.check_engine'),
            assets: $t('security.check_assets'),
            sync: $t('security.check_sync')
        }" :key="label">
            <div class="check-item" :class="{ 'is-active': isDownloading && status[label] < 100 }">
                <div class="item-label">
                    <span class="dot" :class="status[label] === 100 ? 'success' : (status[label] > 0 ? 'warning' : 'info')"></span>
                    <span class="label-text">{{ val }}</span>
                </div>
                <div class="item-progress">
                    <el-progress :percentage="status[label]" :status="getStatusType(status[label])" :show-text="false" />
                    <span class="status-val">
                        <el-icon v-if="isDownloading && status[label] < 100" class="is-loading"><Loading /></el-icon>
                        <span v-else>{{ status[label] }}%</span>
                    </span>
                </div>
            </div>
        </template>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">

        <!-- 状态 A：未就绪 / 下载中 → 展示"下载离线资源"按钮 -->
        <transition name="btn-fade" mode="out-in">
          <el-button
            v-if="!canEnableOffline"
            key="download-btn"
            type="primary"
            :loading="isDownloading"
            :disabled="isDownloading"
            @click="downloadResources"
            class="action-btn"
          >
            <el-icon class="el-icon--left" v-if="!isDownloading"><Download /></el-icon>
            {{ isDownloading
              ? ($t('security.downloading'))
              : ($t('security.download_offline'))
            }}
          </el-button>

          <!-- 状态 B：就绪度 100% → 展示"确认开启"按钮 -->
          <el-button
            v-else
            key="confirm-btn"
            type="success"
            @click="handleConfirm"
            class="action-btn"
          >
            <el-icon class="el-icon--left"><Check /></el-icon>
            {{ $t('security.confirm_enable_offline') }}
          </el-button>
        </transition>

      </div>
    </template>
  </ResponsiveOverlay>

</template>

<style scoped>
.readiness-body {
    padding: 0 10px;
    animation: fadeIn 0.4s ease-out;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

.overall-header {
    display: flex;
    align-items: center;
    gap: 24px;
    margin-bottom: 20px;
    padding: 10px 0;
}
.circle-container {
    flex-shrink: 0;
    transition: transform 0.3s ease;
}
.circle-container:hover {
    transform: scale(1.05);
}
.progress-text {
    display: flex;
    flex-direction: column;
    align-items: center;
}
.progress-text .percentage {
    font-size: 20px;
    font-weight: bold;
}
.progress-text .label {
    font-size: 11px;
    opacity: 0.7;
}
.header-info {
    flex: 1;
}
.header-info h4 {
    margin: 0 0 8px 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--el-text-color-primary);
}
.header-info p {
    margin: 0;
    font-size: 13px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    line-height: 1.5;
}
.header-info p span {
    flex: 1;
}

.check-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 20px;
}
.check-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 4px 0;
    transition: all 0.3s ease;
}
.item-label {
    min-width: 140px;
    font-size: 14px;
    color: var(--el-text-color-regular);
    display: flex;
    align-items: center;
}
.dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    margin-right: 10px;
    flex-shrink: 0;
    transition: all 0.3s ease;
}
.dot.success { background-color: var(--el-color-success); box-shadow: 0 0 8px var(--el-color-success); }
.dot.warning { background-color: var(--el-color-warning); box-shadow: 0 0 8px var(--el-color-warning); }
.dot.info { background-color: var(--el-text-color-placeholder); }

.item-progress {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
}
.item-progress .el-progress {
    flex: 1;
}
.status-val {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    min-width: 35px;
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.text-warning { color: var(--el-color-warning); }
.text-success { color: var(--el-color-success); }

.dialog-footer {
    display: flex;
    justify-content: center;
    padding-top: 10px;
}

.action-btn {
    min-width: 180px;
    height: 40px;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.3px;
}

/* 按钮切换过渡动画 */
.btn-fade-enter-active,
.btn-fade-leave-active {
    transition: all 0.25s ease;
}
.btn-fade-enter-from {
    opacity: 0;
    transform: translateY(6px);
}
.btn-fade-leave-to {
    opacity: 0;
    transform: translateY(-6px);
}

/* 移动端形态优化 */
@media (max-width: 768px) {
    .overall-header {
        flex-direction: column;
        text-align: center;
        gap: 16px;
    }
    .header-info p {
        justify-content: center;
        text-align: left;
    }
    .check-item {
        gap: 8px;
    }
    .item-label {
        font-size: 13px;
        min-width: auto;
    }
}
</style>
