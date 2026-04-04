<template>
  <div class="layout-main" @touchstart="handleTouchStart" @touchmove="handleTouchMove" @touchend="handleTouchEnd">
    
    <!-- 方案1：边缘右滑返回的可视化反馈 (仿 iOS/Android 原生效果) -->
    <div 
      v-if="layoutStore.isMobile && touchStartX < 50 && swipeDistance > 5"
      class="swipe-back-feedback"
      :style="{
        opacity: Math.min(swipeDistance / 100, 0.9),
        transform: `translateY(-50%) translateX(${Math.min(swipeDistance - 45, 15)}px) scale(${0.8 + Math.min(swipeDistance / 350, 0.4)})`
      }"
    >
      <el-icon><ArrowLeft /></el-icon>
    </div>

    <TheHeader />
    <main class="layout-main-content">
      <!-- 全局内容区 Loading： -->
      <div 
        v-if="authUserStore.isVerifying" 
        class="flex-column flex-center text-secondary content-loading-container" 
        :style="loadingContainerStyle"
      >
        <el-icon class="is-loading mb-20 text-primary" :size="48"><Loading /></el-icon>
        <p class="text-16 ls-1">{{ $t('common.loading_data') }}</p>
      </div>
      <RouterView v-else />
    </main>
    <TheFooter v-if="!layoutStore.isMobile" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import { ArrowLeft } from '@element-plus/icons-vue'
import TheHeader from '@/shared/components/theHeader.vue'
import TheFooter from '@/shared/components/theFooter.vue'
import { RouterView } from 'vue-router'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'

const layoutStore = useLayoutStore()
const authUserStore = useAuthUserStore()

// 🚀 内容区 Loading 样式适配：精确对齐 PC 端侧边栏偏移
const loadingContainerStyle = computed(() => {
  if (layoutStore.isMobile) return { minHeight: '440px' }
  
  // PC 端需要偏移侧边栏宽度
  const sidebarWidth = layoutStore.isSidebarCollapsed ? '64px' : '240px'
  return {
    paddingLeft: sidebarWidth,
    minHeight: '520px',
    transition: 'padding-left 0.3s'
  }
})

// --- 移动端手势优化：边缘右滑返回带有 UI 反馈与触觉反馈 ---
let touchStartX = 0
let touchStartTime = 0
const swipeDistance = ref(0)
const isTracking = ref(false)
const hasVibrated = ref(false) // 新增：单次滑动震动锁

const handleTouchStart = (e) => {
  if (!layoutStore.isMobile || !layoutStore.canGoBack) return
  touchStartX = e.touches[0].clientX
  touchStartTime = Date.now()
  swipeDistance.value = 0
  hasVibrated.value = false // 重置状态
  isTracking.value = touchStartX < 50 // 仅从边缘探测时追踪
}

const handleTouchMove = (e) => {
  if (!isTracking.value) return
  const currentX = e.touches[0].clientX
  swipeDistance.value = Math.max(0, currentX - touchStartX)

  // 核心：增加触觉反馈 - 当拉动越过 50px 阈值瞬间震动一下
  if (swipeDistance.value >= 50 && !hasVibrated.value) {
    if ('vibrate' in navigator) {
      try { navigator.vibrate(25) } catch (err) {}
    }
    hasVibrated.value = true
  }
  
  // 阈值回弹重置：用户往回拉时释放震动锁，增加交互乐趣
  if (swipeDistance.value < 40) {
    hasVibrated.value = false
  }
}

const handleTouchEnd = (e) => {
  if (!isTracking.value) return
  
  const touchEndX = e.changedTouches[0].clientX
  const duration = Date.now() - touchStartTime
  const distance = touchEndX - touchStartX
  
  // 阈值：从屏幕左侧边缘向右滑动超过 50px，且时间短于 1500ms
  if (distance > 50 && duration < 1500) {
    layoutStore.goBack()
  }

  // 重置状态
  isTracking.value = false
  swipeDistance.value = 0
  hasVibrated.value = false
}
</script>

<style>
.layout-main {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  position: relative;
}

/* 边缘右滑返回指示器：毛玻璃气泡样式 */
.swipe-back-feedback {
  position: fixed;
  left: -20px;
  top: 50%;
  width: 42px;
  height: 48px;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  border-radius: 0 50% 50% 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  z-index: var(--z-index-gesture);
  pointer-events: none;
  font-size: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-left: none;
}

 [data-theme='dark'] .swipe-back-feedback {
  background: rgba(255, 255, 255, 0.1);
}
</style>


