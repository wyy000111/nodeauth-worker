<template>
  <!-- 桌面端策略：使用 Element Plus 标准对话框 -->
  <el-dialog
    v-if="!isMobile"
    v-bind="attrs"
    v-model="visible"
    :title="title"
    :width="width"
    :destroy-on-close="destroyOnClose"
    :close-on-click-modal="closeOnClickModal"
    :align-center="true"
    :center="center"
    append-to-body
    class="responsive-overlay-desktop"
  >
    <template v-if="$slots.header" #header>
      <slot name="header" />
    </template>
    
    <slot />
    
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </el-dialog>

  <!-- 移动端策略：使用自制的高性能原生抽屉 -->
  <AppMobileDrawer
    v-else
    v-model="visible"
    :title="title"
    :center="center"
    :content-style="keyboardAvoidanceStyle"
    class="responsive-overlay-mobile"
  >
    <template v-if="$slots.header" #header>
      <slot name="header" />
    </template>
    
    <slot />
    
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </AppMobileDrawer>
</template>

<script setup>
import { computed, useAttrs } from 'vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { ElDialog } from 'element-plus'
import AppMobileDrawer from './appMobileDrawer.vue'
import { useVisualViewport } from '@/shared/composables/useVisualViewport'

const props = defineProps({
  modelValue: Boolean,
  title: String,
  center: {
    type: Boolean,
    default: false
  },
  width: {
    type: String,
    default: '400px'
  },
  destroyOnClose: {
    type: Boolean,
    default: true
  },
  closeOnClickModal: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['update:modelValue'])
const attrs = useAttrs()
const layoutStore = useLayoutStore()

const isMobile = computed(() => layoutStore.isMobile)
const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

// 引入键盘避让逻辑引擎
const { keyboardAvoidanceStyle } = useVisualViewport()
</script>



