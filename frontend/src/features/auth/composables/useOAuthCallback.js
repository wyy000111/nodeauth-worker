import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { setIdbItem, getIdbItem, removeIdbItem } from '@/shared/utils/idb'
import { authService } from '@/features/auth/service/authService'

/**
 * 处理 OAuth 授权重定向回来的回调逻辑 (验证、防伪造、Token 兑换)
 */
export function useOAuthCallback() {
    const route = useRoute()
    const router = useRouter()
    const { t } = useI18n()
    const errorMsg = ref('')
    const providerName = ref(t('auth.default_provider'))

    onMounted(async () => {
        const code = route.query.code
        const state = route.query.state
        const error = route.query.error
        const hash = route.query.hash // Telegram 特有参数

        // 1. 智能识别 Provider
        let providerId = route.params.provider
        if (!providerId) {
            if (hash) providerId = 'telegram'
            else providerId = (await getIdbItem('tmp:auth:provider')) || 'github'
        }

        // 优化：优先从缓存读取提供商名称
        try {
            const cached = await getIdbItem('sys:cache:providers')
            if (cached) {
                const providers = cached
                const p = providers.find(x => x.id === providerId)
                if (p) providerName.value = p.name
            } else {
                const res = await authService.getProviders()
                const p = res.providers?.find(x => x.id === providerId)
                if (p) providerName.value = p.name
            }
        } catch (e) {
            // Ignore cache errors
        }

        if (error) {
            errorMsg.value = route.query.error_description || t('auth.oauth_declined', { provider: providerName.value })
            return
        }

        // 2. 参数结构校验 (策略分发)
        let payload = {}

        if (providerId === 'telegram') {
            if (!hash) {
                errorMsg.value = t('auth.telegram_missing_hash')
                return
            }
            const savedState = await getIdbItem('tmp:auth:state')
            payload = { ...route.query, state: savedState }
        } else {
            if (!code || !state) {
                errorMsg.value = t('auth.missing_auth_params')
                return
            }

            // 防御 CSRF：必须检查 State 匹不匹配
            const savedState = await getIdbItem('tmp:auth:state')
            if (!savedState || savedState !== state) {
                errorMsg.value = t('auth.state_mismatch')
                return
            }

            const codeVerifier = await getIdbItem('tmp:auth:verifier')
            payload = { code, state, codeVerifier }
        }

        // 无论成功与否，用过一次立马清除防止重放 (Replay Attack)
        await removeIdbItem('tmp:auth:state')
        await removeIdbItem('tmp:auth:provider')
        await removeIdbItem('tmp:auth:verifier')

        try {
            const startTime = Date.now()
            // Telegram 用户体验优化：强制展示 1.5s 的 Loading 画风
            const MIN_DISPLAY_TIME = providerId === 'telegram' ? 1500 : 0

            // 向后端服务进行 Token 兑换
            const data = await authService.loginWithToken(providerId, payload)

            const elapsed = Date.now() - startTime
            if (elapsed < MIN_DISPLAY_TIME) {
                await new Promise(resolve => setTimeout(resolve, MIN_DISPLAY_TIME - elapsed))
            }

            if (data.success) {
                // 持久化设备指纹标识 (Device Key / Salt)
                // 核心: 离线秒开和端到端加密的解密因子
                if (data.deviceKey) {
                    await setIdbItem('sys:sec:device_salt', data.deviceKey)
                }
                // 更新状态机进入应用主流程
                const authUserStore = useAuthUserStore()

                // 将用户信息和设置状态存入 store
                await authUserStore.setUserInfo(data.userInfo, !!data.needsEmergency, data.encryptionKey || '')

                // 清理旧的 Tab 状态，确保干净进入首页
                sessionStorage.clear()

                if (data.needsEmergency) {
                    router.push('/emergency')
                } else {
                    router.push('/')
                }
            } else {
                errorMsg.value = data.error || t('auth.login_rejected')
            }
        } catch (err) {
            console.error('OAuth Callback Error:', err)
            // Error Managed by request interceptor and authError mapping
            errorMsg.value = err.message || t('auth.network_abnormal')
        }
    })

    const goBackToLogin = () => {
        router.push('/login')
    }

    return {
        errorMsg,
        providerName,
        goBackToLogin
    }
}
