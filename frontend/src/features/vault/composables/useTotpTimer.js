/* src/features/vault/composables/useTotpTimer.js */
import { ref } from 'vue'
import { getAccurateTime } from '@/shared/utils/totp'

/**
 * 核心重构（战役一）：状态下沉与全局心跳引擎
 * 抛弃了以往遍历大数组的操作，彻底解除了由于修改 item 属性导致的父级 Vue List 响应式爆炸。
 * 提供单例模式下的高精度时钟，允许多个子卡片自由订阅而不再产生额外开销。
 */
const currentTime = ref(getAccurateTime() / 1000)
let globalTimer = null
let subscribers = 0

export function useTotpTimer() {
    const startTimer = () => {
        subscribers++
        if (!globalTimer) {
            // 每秒只推进唯一的一枚指针，时间复杂度永远 O(1)
            const tick = () => {
                currentTime.value = getAccurateTime() / 1000
            }
            tick() // 启动瞬间先走一步
            globalTimer = setInterval(tick, 1000)
        }
    }

    const stopTimer = () => {
        subscribers--
        if (subscribers <= 0 && globalTimer) {
            clearInterval(globalTimer)
            globalTimer = null
            subscribers = 0
        }
    }

    return {
        currentTime,
        startTimer,
        stopTimer
    }
}
