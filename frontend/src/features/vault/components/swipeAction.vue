<template>
  <div 
    class="swipe-action-container" 
    :class="{ 'is-open': isOpen, 'is-swiping': isSwiping }"
    ref="containerRef"
  >
    <!-- Background Actions Layer (Behind Content) -->
    <div 
      class="swipe-actions left-actions" 
      ref="leftActionsRef"
      :style="{ opacity: translateX > 0 ? 1 : 0, visibility: translateX > 0 ? 'visible' : 'hidden' }"
    >
      <slot name="left-actions" />
    </div>
    
    <div 
      class="swipe-actions right-actions" 
      ref="rightActionsRef"
      :style="{ opacity: translateX < 0 ? 1 : 0, visibility: translateX < 0 ? 'visible' : 'hidden' }"
    >
      <slot name="right-actions" />
    </div>

    <!-- Foreground Content Layer -->
    <div 
      class="swipe-action-content"
      :style="contentStyle"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
      @touchcancel="handleTouchEnd"
    >
      <slot />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  id: { type: [String, Number], default: null },
  disabled: { type: Boolean, default: false },
  threshold: { type: Number, default: 0.3 } // Percentage of action width to snap
})

const emit = defineEmits(['open', 'close'])

const containerRef = ref(null)
const leftActionsRef = ref(null)
const rightActionsRef = ref(null)

const translateX = ref(0)
const isSwiping = ref(false)
const isOpen = ref(false)
const currentSide = ref(null) // 'left' or 'right'

let startX = 0
let startY = 0
let initialTranslateX = 0
let startTime = 0
let isHorizontal = null

const leftWidth = computed(() => leftActionsRef.value?.offsetWidth || 0)
const rightWidth = computed(() => rightActionsRef.value?.offsetWidth || 0)

const contentStyle = computed(() => ({
  transform: `translateX(${translateX.value}px)`,
  transition: isSwiping.value ? 'none' : 'transform 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.15)'
}))

const handleTouchStart = (e) => {
  if (props.disabled) return
  
  const touch = e.touches[0]
  startX = touch.clientX
  startY = touch.clientY
  initialTranslateX = translateX.value
  startTime = Date.now()
  isSwiping.value = true
  isHorizontal = null
}

const handleTouchMove = (e) => {
  if (props.disabled || !isSwiping.value) return
  
  const touch = e.touches[0]
  const deltaX = touch.clientX - startX
  const deltaY = touch.clientY - startY

  // Locking mechanism: Decide axis in the first 15px (Recommended for modern devices)
  if (isHorizontal === null) {
     if (Math.abs(deltaX) > 15 || Math.abs(deltaY) > 15) {
        isHorizontal = Math.abs(deltaX) > Math.abs(deltaY)
     }
  }

  if (isHorizontal) {
    if (e.cancelable) e.preventDefault()
    
    let nextX = initialTranslateX + deltaX
    
    // Resistance logic (Elasticity)
    if (nextX > leftWidth.value) {
       nextX = leftWidth.value + (nextX - leftWidth.value) * 0.2
    } else if (nextX < -rightWidth.value) {
       nextX = -rightWidth.value + (nextX + rightWidth.value) * 0.2
    }
    
    translateX.value = nextX
  }
}

const handleTouchEnd = () => {
  if (props.disabled) return
  isSwiping.value = false
  
  const absX = Math.abs(translateX.value)
  const duration = Date.now() - startTime
  
  // Decision logic: Snap open or close
  if (translateX.value > 0) {
    // Reveal left actions (swiping right)
    if (translateX.value > leftWidth.value * props.threshold || (duration < 250 && translateX.value > 20)) {
       translateX.value = leftWidth.value
       isOpen.value = true
       currentSide.value = 'left'
       emit('open', 'left')
       notifyOpened()
    } else {
       reset()
    }
  } else if (translateX.value < 0) {
    // Reveal right actions (swiping left)
    if (absX > rightWidth.value * props.threshold || (duration < 250 && absX > 20)) {
       translateX.value = -rightWidth.value
       isOpen.value = true
       currentSide.value = 'right'
       emit('open', 'right')
       notifyOpened()
    } else {
       reset()
    }
  } else {
    reset()
  }
}

const notifyOpened = () => {
  if (('vibrate' in navigator)) {
    try { navigator.vibrate(10) } catch (e) {}
  }
  if (!props.id) return
  window.dispatchEvent(new CustomEvent('swipe-action:opened', { 
    detail: { id: props.id } 
  }))
}

const handleGlobalOpen = (e) => {
  if (isOpen.value && e.detail.id !== props.id) {
    reset()
  }
}

const handleGlobalClick = (e) => {
  if (isOpen.value && !containerRef.value?.contains(e.target)) {
    reset()
  }
}

onMounted(() => {
  window.addEventListener('swipe-action:opened', handleGlobalOpen)
  window.addEventListener('touchstart', handleGlobalClick, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('swipe-action:opened', handleGlobalOpen)
  window.removeEventListener('touchstart', handleGlobalClick)
})

const reset = () => {
  translateX.value = 0
  isOpen.value = false
  currentSide.value = null
  emit('close')
}

defineExpose({ reset })
</script>
