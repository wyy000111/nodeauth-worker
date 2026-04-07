import { ref, onMounted, onUnmounted, computed } from 'vue'

/**
 * 核心架构资产：移动端视口监听 Composable
 * 用于解决移动端软键盘弹出导致的视口遮挡、偏移计算等顽疾
 */
export function useVisualViewport() {
    const keyboardHeight = ref(0)
    const viewportHeight = ref(window.innerHeight)
    const isKeyboardVisible = computed(() => keyboardHeight.value > 0)

    const handleResize = () => {
        if (!window.visualViewport) return

        const vh = window.visualViewport.height
        viewportHeight.value = vh

        const windowHeight = window.innerHeight
        // 阈值检测：视口高度缩减超过 15% 判定为键盘弹出
        if (vh < windowHeight * 0.85) {
            keyboardHeight.value = Math.max(0, windowHeight - vh)
        } else {
            keyboardHeight.value = 0
        }
    }

    onMounted(() => {
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', handleResize)
            window.visualViewport.addEventListener('scroll', handleResize)
            // 初始化执行一次
            handleResize()
        }
    })

    onUnmounted(() => {
        if (window.visualViewport) {
            window.visualViewport.removeEventListener('resize', handleResize)
            window.visualViewport.removeEventListener('scroll', handleResize)
        }
    })

    return {
        keyboardHeight,
        viewportHeight,
        isKeyboardVisible,
        // 提供给组件使用的动态样式计算器
        keyboardAvoidanceStyle: computed(() => ({
            // 当键盘不显示时，不注入任何额外的 Padding，由组件内部样式处理基础安全区
            paddingBottom: keyboardHeight.value > 0 ? `${keyboardHeight.value + 12}px` : '0',
            transition: 'padding-bottom 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }))
    }
}
