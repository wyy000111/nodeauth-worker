<template>
  <component
    :is="currentOverlayComponent"
    v-bind="componentProps"

    v-model="visible"
    class="responsive-overlay"
    :class="{ 'is-mobile-drawer': isMobile }"
  >
    <template v-if="$slots.header" #header>
      <slot name="header" />
    </template>
    
    <slot />
    
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </component>
</template>

<script setup>
import { computed, useAttrs } from 'vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'

const props = defineProps({
  modelValue: Boolean,
  title: String,
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

// Manually import to solve unplugin component scanning issue with <component :is>
import { ElDialog, ElDrawer } from 'element-plus'

const isMobile = computed(() => layoutStore.isMobile)
const currentOverlayComponent = computed(() => isMobile.value ? ElDrawer : ElDialog)

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const componentProps = computed(() => {
  if (isMobile.value) {
    return {
      ...attrs,
      title: props.title,
      direction: 'btt',
      size: 'auto',
      'destroy-on-close': props.destroyOnClose,
      'close-on-click-modal': props.closeOnClickModal,
      'append-to-body': true,
      'z-index': 2000,
      class: 'app-mobile-drawer'
    }
  } else {
    return {
      ...attrs,
      title: props.title,
      width: props.width,
      'destroy-on-close': props.destroyOnClose,
      'close-on-click-modal': props.closeOnClickModal,
      'align-center': true,
      'append-to-body': true,
      'z-index': 2000
    }
  }
})
</script>


<style>
/* Global styles for the mobile drawer to make it look native */
.app-mobile-drawer.el-drawer {
    border-radius: 20px 20px 0 0 !important;
    overflow: hidden !important;
    height: auto !important;
    min-height: 300px !important;
    max-height: 92vh !important;
    bottom: 0 !important;
    top: auto !important;
    box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.2) !important;
}

.app-mobile-drawer .el-drawer__body {
    padding: 20px 20px calc(24px + env(safe-area-inset-bottom)) !important; /* Bottom padding for iOS */
    overflow-y: auto !important;
    flex: 1 1 auto !important; /* Allow body to grow */
}



.app-mobile-drawer .el-drawer__header {
    margin-bottom: 15px;
    padding-top: 25px;
    font-weight: 700;
}



/* Add a handle bar at the top of the drawer */
.app-mobile-drawer::before {
    content: "";
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    width: 40px;
    height: 4px;
    background: var(--el-border-color-lighter);
    border-radius: 2px;
    z-index: 10;
}

.app-mobile-drawer .el-drawer__body {
    padding: 20px;
    overflow-y: auto;
}

.app-mobile-drawer .el-drawer__footer {
    padding: 20px 20px calc(40px + env(safe-area-inset-bottom)) !important; /* Deep safety for iOS Home Indicator */
    border-top: 1px solid var(--el-border-color-extra-light);
}
</style>

