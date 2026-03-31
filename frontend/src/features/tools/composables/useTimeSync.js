import { ref, computed, onMounted, onUnmounted } from 'vue'
import { toolService } from '@/features/tools/service/toolService'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { i18n } from '@/locales'

/**
 * 时间校准逻辑提取
 * 
 * @returns {Object} 包含校准状态与方法的响应式对象
 */
export function useTimeSync() {
    const layoutStore = useLayoutStore()
    const localTime = ref(Date.now())
    const cachedOffset = localStorage.getItem('app_time_offset')
    const offset = ref(cachedOffset !== null ? parseInt(cachedOffset) : null)
    const rtt = ref(null)
    const isSyncing = ref(false)
    let clockTimer = null

    const serverTime = computed(() => localTime.value + (offset.value || 0))

    const syncStatus = computed(() => {
        if (offset.value === null) return null
        const abs = Math.abs(offset.value)
        const { t } = i18n.global

        // 允许额外增加一条断网后的提示说明
        if (layoutStore.isOffline) {
            return { title: t('tools.sync_offline'), type: 'warning', desc: t('tools.sync_offline_desc') }
        }

        if (abs < 2000) return { title: t('tools.sync_normal'), type: 'success', desc: t('tools.sync_normal_desc') }
        if (abs < 30000) return { title: t('tools.sync_warning'), type: 'warning', desc: t('tools.sync_warning_desc') }
        return { title: t('tools.sync_error'), type: 'error', desc: t('tools.sync_error_desc') }
    })

    const syncTime = async () => {
        // 如果断网，进行智能回退（使用本地缓存的偏差值推演）
        if (layoutStore.isOffline) {
            if (offset.value !== null) {
                return { success: true, offset: offset.value, offlineFallback: true }
            } else {
                return { success: false, error: new Error(i18n.global.t('api_errors.offline')), offlineFallback: true }
            }
        }

        isSyncing.value = true
        const start = Date.now()
        try {
            const res = await toolService.getServerTime()
            const end = Date.now()
            if (res.success) {
                const serverTs = res.time
                rtt.value = end - start
                // 假设往返时间是对称的，服务器返回时间为收到请求时的 serverTs + 单程网络延迟
                const estimatedServerTime = serverTs + (rtt.value / 2)
                offset.value = Math.round(estimatedServerTime - end)
                localStorage.setItem('app_time_offset', offset.value)
                return { success: true, offset: offset.value }
            }
            return { success: false, error: new Error('返回结构异常') }
        } catch (error) {
            return { success: false, error }
        } finally {
            isSyncing.value = false
        }
    }

    onMounted(() => {
        clockTimer = setInterval(() => { localTime.value = Date.now() }, 1000)
    })

    onUnmounted(() => {
        if (clockTimer) clearInterval(clockTimer)
    })

    return {
        localTime,
        serverTime,
        offset,
        rtt,
        isSyncing,
        syncStatus,
        syncTime
    }
}
