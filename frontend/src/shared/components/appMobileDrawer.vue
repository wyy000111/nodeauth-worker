<template>
  <transition name="drawer-slide">
    <div v-if="modelValue" class="app-mobile-drawer-overlay" @click.self="emit('update:modelValue', false)">
      <div class="app-mobile-drawer-content" :style="contentStyle">
        <!-- 抽屉把手 (Handle) -->
        <div class="drawer-handle-bar" />
        
        <!-- 标题层 (底层) -->
        <div class="drawer-header-area" :class="{ 'is-centered': center }">
          <div class="drawer-header-main">
            <slot name="header">
              <span class="drawer-title-text">{{ title }}</span>
            </slot>
          </div>
          
          <!-- 操作层 (顶层) -->
          <div class="close-action" @click="emit('update:modelValue', false)">
            <el-icon class="close-icon"><Close /></el-icon>
          </div>
        </div>

        <!-- 正文区域 -->
        <div class="drawer-main-body">
          <slot />
        </div>

        <!-- 页脚区域 -->
        <div v-if="$slots.footer" class="drawer-footer-area">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed } from 'vue'
import { Close } from '@element-plus/icons-vue'

const props = defineProps({
  modelValue: Boolean,
  title: String,
  center: {
    type: Boolean,
    default: false
  },
  // 专门接收 Composable 计算出的键盘避让样式
  contentStyle: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:modelValue'])
</script>

<style scoped>
.app-mobile-drawer-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    height: 100dvh; /* 动态视口高度，自动避让浏览器地址栏 */
    background: rgba(0, 0, 0, 0.4);
    z-index: 3000;
    backdrop-filter: blur(4px);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
}

.app-mobile-drawer-content {
    box-sizing: border-box;
    width: 100%;
    background: var(--el-bg-color);
    border-radius: 24px 24px 0 0;
    padding: 0; /* 移除全局 Padding，改为内部分发 */
    box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.15);
    max-height: 94vh;
    min-height: 200px;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
}

.drawer-handle-bar {
    width: 36px;
    height: 4px;
    background: var(--el-border-color-lighter);
    border-radius: 2px;
    margin: -10px auto 14px;
    flex-shrink: 0;
}

.drawer-header-area {
    width: 100%;
    position: relative;
    box-sizing: border-box;
    min-height: 52px;
    flex-shrink: 0;
    margin-bottom: 5px;
}

.drawer-header-main {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 0 54px 0 20px;
    box-sizing: border-box;
    z-index: 1;
}

.is-centered .drawer-header-main {
    justify-content: center;
    padding: 0 54px; /* 对等避让，确保文字绝对居中 */
}

.close-action {
    position: absolute;
    right: 8px;
    top: 45%;
    transform: translateY(-50%);
    width: 42px;
    height: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: transparent;
    color: var(--el-text-color-secondary);
    transition: color 0.3s;
    z-index: 10;
}

.close-action:hover {
    color: var(--el-text-color-primary);
}

.drawer-title-text {
    font-weight: 700;
    font-size: 1.05rem;
    color: var(--el-text-color-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
}

.close-icon {
    font-size: 16px;
    display: block;
}

.drawer-main-body {
    overflow-y: auto;
    flex: 1;
    padding: 0 20px 20px; /* 重新注入 Body 的 Padding */
}

.drawer-footer-area {
    padding: 15px 20px calc(35px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--el-border-color-extra-light);
    margin-top: 5px;
    flex-shrink: 0;
    text-align: right;
}

/* 动效 */
.drawer-slide-enter-active, .drawer-slide-leave-active {
    transition: opacity 0.3s ease;
}
.drawer-slide-enter-from, .drawer-slide-leave-to {
    opacity: 0;
}

.drawer-slide-enter-active .app-mobile-drawer-content {
    animation: slide-up 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes slide-up {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
}
</style>
