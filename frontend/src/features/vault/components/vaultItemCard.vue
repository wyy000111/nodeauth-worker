<template>
  <el-card 
    class="vault-card" 
    :class="{ 
      'is-selected': isSelected, 
      'is-dragging': isDragging,
      'is-pressing': isPressing,
      'is-compact': isCompact,
      'is-pending': isPending,
      'is-ghost-mode': layoutStore.appGhostMode,
      'is-revealed': isRevealed
    }"
    shadow="hover"
  >
    <div class="card-header">
      <div class="service-info">
        <el-checkbox :model-value="isSelected" @change="$emit('toggle-selection', item.id)" @click.stop />
        <VaultIcon :service="item.service" :size="isCompact ? 20: 24" />
        <h3 class="service-name" :title="item.service">{{ item.service }}</h3>
        <el-tag size="small" v-if="item.category" effect="light">{{ item.category }}</el-tag>
        <!-- 离线标记 -->
        <el-tooltip v-if="isPending && item.status !== 'conflict'" :content="$t('vault.pending_sync_tip')">
          <el-icon class="pending-icon ml-5"><Upload /></el-icon>
        </el-tooltip>
        <!-- 冲突标记 -->
        <el-tooltip v-if="item.status === 'conflict'" :content="$t('vault.conflict_detected_tip')">
          <el-icon class="conflict-icon ml-5" color="#F56C6C"><WarningFilled /></el-icon>
        </el-tooltip>
      </div>
      
      <el-dropdown trigger="click" @command="(cmd) => $emit('command', cmd, item)">
        <el-icon class="more-icon" @click.stop><MoreFilled /></el-icon>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="qr">
              <el-icon><Picture /></el-icon> {{ $t('vault.export_account') }}
            </el-dropdown-item>
            <el-dropdown-item command="edit">
              <el-icon><Edit /></el-icon> {{ $t('common.edit') }}
            </el-dropdown-item>
            <el-dropdown-item command="delete" class="text-danger">
              <el-icon><Delete /></el-icon> {{ $t('common.delete') }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <p class="vault-name">{{ displayAccount }}</p>

    <div class="code-display-area" 
         @click.stop="$emit('copy-code', item, currentCode)"
         @mousedown="handleRevealStart" 
         @mouseup="handleRevealEnd" 
         @mouseleave="handleRevealEnd" 
         @touchstart="handleRevealStart" 
         @touchend="handleRevealEnd" 
         @touchcancel="handleRevealEnd"
    >
      <div class="code-left">
        <div class="current-code" :data-digits="digits">
          <template v-if="currentCode && currentCode !== '------'">
            <span>{{ codeGroups[0] }}</span>
            <span class="code-divider"></span>
            <span>{{ codeGroups[1] }}</span>
          </template>
          <template v-else>------</template>
        </div>
        <div class="next-code" v-if="isMobile && nextCode" :data-digits="digits">
          <span>{{ nextCodeGroups[0] }}</span>
          <span class="code-divider is-next"></span>
          <span>{{ nextCodeGroups[1] }}</span>
        </div>
      </div>
      <div class="code-right" v-if="currentCode !== '------'">
        <el-progress 
          type="circle" 
          :percentage="percentage" 
          :width="isCompact ? 24 : 30" 
          :stroke-width="isCompact ? 2 : 3" 
          :color="currentColor"
        >
          <template #default>
            <span class="timer-text">{{ remaining }}</span>
          </template>
        </el-progress>
      </div>
      <div v-else class="code-right">
        <el-icon class="is-loading"><Loading /></el-icon>
      </div>
    </div>

    <!-- 🛡️ 冲突解决遮罩 (Conflict Resolution Overlay) -->
    <div v-if="item.status === 'conflict'" class="conflict-overlay">
       <div class="conflict-content">
          <p class="conflict-text">{{ $t('vault.conflict_notice') }}</p>
          <div class="conflict-actions">
             <el-button size="small" type="primary" plain @click.stop="$emit('resolve-conflict', item.id, 'force')">
                {{ $t('vault.force_sync') }}
             </el-button>
             <el-button size="small" type="danger" plain @click.stop="$emit('resolve-conflict', item.id, 'discard')">
                {{ $t('vault.discard_local') }}
             </el-button>
          </div>
       </div>
    </div>
  </el-card>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { MoreFilled, Edit, Delete, Picture, Loading, Upload, WarningFilled } from '@element-plus/icons-vue'
import VaultIcon from '@/features/vault/components/vaultIcon.vue'
import { generateTOTP } from '@/shared/utils/totp'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { useTotpTimer } from '@/features/vault/composables/useTotpTimer'

const layoutStore = useLayoutStore()
const isRevealed = ref(false)
let revealTimer = null

// 用于点击判定：记录起始点，防滑误触
let startX = 0
let startY = 0

const handleRevealStart = (e) => {
  if (!layoutStore.appGhostMode) return
  
  // 记录初始触摸/点击坐标
  if (e.type === 'touchstart' && e.touches && e.touches.length > 0) {
    const touch = e.touches[0]
    startX = touch.clientX
    startY = touch.clientY
  } else if (e.type === 'mousedown') {
    startX = e.clientX
    startY = e.clientY
  }
}

const handleRevealEnd = (e) => {
  if (!layoutStore.appGhostMode) return

  // 移动端：双向滑动检测 (上滑/下滑/左滑/右滑)
  if (e && e.type.startsWith('touch') && e.changedTouches && e.changedTouches.length > 0) {
    const touch = e.changedTouches[0]
    const deltaX = Math.abs(touch.clientX - startX)
    const deltaY = Math.abs(touch.clientY - startY)

    // 如果手指由于上下滑动(下滑加载)或左右摆动导致位移超过 10px，则判定为手势操作，不揭层
    if (deltaX > 10 || deltaY > 10) return
  }

  // 桌面端：如果是鼠标操作，通常不考虑长位移误触，但可以增加简单的判定
  if (e.type === 'mouseup') {
     const deltaX = Math.abs(e.clientX - startX)
     const deltaY = Math.abs(e.clientY - startY)
     if (deltaX > 10 || deltaY > 10) return
  }

  // 执行揭密显示逻辑
  isRevealed.value = true
  if (revealTimer) {
    clearTimeout(revealTimer)
  }
  
  // 保持 30s 后自动遮挡，防止忘记遮掩
  revealTimer = setTimeout(() => {
    isRevealed.value = false
    revealTimer = null
  }, 30000)
}

// Ensure timer is cleared on unmount
onUnmounted(() => {
  if (revealTimer) clearTimeout(revealTimer)
  stopTimer()
})

const props = defineProps({
  item: { type: Object, required: true },
  isSelected: { type: Boolean, default: false },
  isDragging: { type: Boolean, default: false },
  isPressing: { type: Boolean, default: false },
  isCompact: { type: Boolean, default: false },
  isPending: { type: Boolean, default: false },
  isMobile: { type: Boolean, default: false }
})

defineEmits(['toggle-selection', 'command', 'copy-code', 'resolve-conflict'])

const { currentTime, startTimer, stopTimer } = useTotpTimer()

const currentCode = ref('------')
const nextCode = ref(null)

const lastEpoch = ref(null)
const lastNextEpoch = ref(null)

const period = computed(() => props.item.period || 30)
const digits = computed(() => props.item.digits || 6)
const algorithm = computed(() => {
    return props.item.algorithm 
      ? props.item.algorithm.toUpperCase().replace('SHA', 'SHA-').replace('SHA--', 'SHA-') 
      : 'SHA-1'
})

// UI 计算脱离全局大循环，转移至单一组件内
const remaining = computed(() => {
  return Math.ceil(period.value - (currentTime.value % period.value))
})

const percentage = computed(() => {
  return (remaining.value / period.value) * 100
})

const currentColor = computed(() => {
    if (remaining.value > 10) return '#67C23A'
    if (remaining.value > 5) return '#E6A23C'
    return '#F56C6C'
})

const displayAccount = computed(() => {
  return props.item.account?.includes(':') 
    ? props.item.account.split(':').pop() 
    : props.item.account
})

// Code 分组分割逻辑
const getGroups = (code, len) => {
    if (!code || code === '------' || code === 'ERROR') return [code, '']
    const middle = Math.floor(len / 2)
    return [code.substring(0, middle), code.substring(middle)]
}
const codeGroups = computed(() => getGroups(currentCode.value, digits.value))
const nextCodeGroups = computed(() => getGroups(nextCode.value, digits.value))

const computeCodes = async () => {
    if (!props.item.secret) {
        currentCode.value = 'ERROR'
        return
    }
    const epoch = Math.floor(currentTime.value / period.value)
    
    if (lastEpoch.value !== epoch || currentCode.value === '------') {
        currentCode.value = await generateTOTP(props.item.secret, period.value, digits.value, algorithm.value)
        lastEpoch.value = epoch
    }

    if (remaining.value <= 5 && props.isMobile) {
        if (!nextCode.value || lastNextEpoch.value !== epoch + 1) {
            nextCode.value = await generateTOTP(props.item.secret, period.value, digits.value, algorithm.value, 1)
            lastNextEpoch.value = epoch + 1
        }
    } else {
        nextCode.value = null
    }
}

// 核心：每次全局时钟滴答，仅当内部密码过期才重算
watch(currentTime, computeCodes)
// Props 变更强制刷新（供搜索或强制重载使用）
watch(() => props.item.secret, () => {
   currentCode.value = '------'
   lastEpoch.value = null
   computeCodes()
})

// 防止虚拟滚动复用 DOM 导致防窥屏状态泄露到别的账号上
watch(() => props.item.id, () => {
   isRevealed.value = false
   if (revealTimer) {
      clearTimeout(revealTimer)
      revealTimer = null
   }
})

onMounted(() => {
    startTimer()
    computeCodes()
})
</script>
