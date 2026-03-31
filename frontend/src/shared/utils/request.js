import { ElMessage } from 'element-plus'
// Removed router import to solve circular dependency and facilitate physical redirects
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { i18n } from '@/locales'
import { removeIdbItem } from '@/shared/utils/idb'

// 辅助函数：从 document.cookie 中安全地读取指定的 cookie 值
export function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

import { useLayoutStore } from '@/features/home/store/layoutStore'

let isNavigatingToLogin = false; // 增加防重入锁，避免并发 401 触发无限弹窗和跳转

export async function request(url, options = {}) {
    // --- 🛡️ 离线模式 (Air-Gapped) 强力保护拦截 ---
    // 为币圈用户设计的绝对安全开关：开启后物理阻断所有 API 请求，应用将完全依赖本地 Service Worker 和 IndexedDB 运行
    const layoutStore = useLayoutStore()
    if (layoutStore.isManualOffline) {
        // 离线白名单：登录接口 + /me 身份自愈接口 (允许在离线刷新后恢复 device_salt)
        const isAuthRoute = url.includes('/api/oauth/login') ||
            url.includes('/api/oauth/verify') ||
            url.includes('/api/oauth/me') ||
            url.includes('/api/health')
        if (!isAuthRoute) {
            console.warn(`[Air-Gapped] Request blocked: ${url}`);
            const offlineErr = new Error('offline_mode_active');
            offlineErr.isOffline = true;
            throw offlineErr;
        }
    }

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    }

    const csrfToken = getCookie('csrf_token');
    if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
    }

    // --- 离线与超时维稳拦截 (Network & Timeout Shield) ---
    // 解决移动端 PWA 切后台再切回时，TCP 假死导致的 fetch 无限挂起问题 (特别是 Web3 验证阶段)
    const timeoutMs = options.timeout || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            headers,
            credentials: 'include',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        // 针对 204 No Content，没有 body，直接返回成功
        if (response.status === 204) {
            return { success: true };
        }

        const data = await response.json()

        // --- 全局拦截 OAuth Token 撤销信号 (统一各存储源报错) ---
        if (data.message && typeof data.message === 'string' && data.message.includes('oauth_token_revoked')) {
            const oauthErr = new Error('oauth_token_revoked');
            oauthErr.isOAuthRevoked = true;
            throw oauthErr;
        }

        // --- 安全拦截大网 (Security Shield Interceptor) ---
        // 如果后端检测到环节变量配置危险，抛出全局 403，立刻拦截死并跳转
        if (response.status === 403 && data.message === 'health_check_failed') {
            if (window.location.pathname !== '/health') {
                window.location.href = '/health';
            }
            // Wrap a specific error to throw to UI
            const secErr = new Error('Security Check Failed');
            secErr.data = data.data; // issues array
            secErr.isSecurity = true;
            throw secErr;
        }

        // 处理 401 Unauthorized (后端统一抛出的 AppError 会被 index.ts 捕获并返回 { code: 401, success: false, message: ...})
        if (response.status === 401 || data.code === 401) {
            if (options.silent) {
                throw new Error(data.message || data.error || 'Unauthorized/Forbidden')
            }

            if (!isNavigatingToLogin) {
                isNavigatingToLogin = true;

                // 这里我们暂且尝试直接翻译：假设后端抛出的 data.message 已经是 ERROR_CODE
                // 或者我们可以尝试：如果字典里包含这个 message 的 key 就翻译，否则原样输出
                let fallbackMessage = data.message || data.error || 'session_expired'
                let errorDetails = ''
                if (typeof fallbackMessage === 'string' && fallbackMessage.includes(':')) {
                    const parts = fallbackMessage.split(':')
                    fallbackMessage = parts[0].trim()
                    errorDetails = parts.slice(1).join(':').trim()
                }

                let translatedMessage = i18n.global.te(`api_errors.${fallbackMessage}`)
                    ? i18n.global.t(`api_errors.${fallbackMessage}`)
                    : fallbackMessage

                if (errorDetails) {
                    let detailParts = errorDetails.split(':')
                    let detailKey = detailParts[0].trim()
                    if (i18n.global.te(`api_errors.${detailKey}`)) {
                        detailParts[0] = i18n.global.t(`api_errors.${detailKey}`)
                        errorDetails = detailParts.join(': ')
                    }
                    translatedMessage = `${translatedMessage}: ${errorDetails}`
                }

                ElMessage.error(translatedMessage)

                // 调用 Pinia Action 清空用户信息、缓存、以及重置内存状态，防止路由守卫死循环打回
                try {
                    const authUserStore = useAuthUserStore()
                    authUserStore.clearUserInfo()
                } catch (e) {
                    // Fallback to manual IDB clear if store is unavailable
                    removeIdbItem('auth:user:profile')
                    removeIdbItem('vault:data:main')
                    removeIdbItem('vault:conf:backups')
                    removeIdbItem('sys:sec:device_salt')
                    sessionStorage.removeItem('app_vault_session_key')
                }

                if (window.location.pathname !== '/login') {
                    // 全局会话过期使用物理跳转，清空内存所有闭包与过期 JS 分块引用
                    window.location.href = '/login'
                } else {
                    setTimeout(() => { isNavigatingToLogin = false }, 1000)
                }
            }
            throw new Error(data.message || data.error || 'Unauthorized/Forbidden')
        }

        // 处理其他业务报错或 HTTP 错误
        // 注意：兼容旧的 data.error 和新的 data.message
        if (!response.ok || data.success === false) {
            if (!options.silent) {
                let fallbackError = data.message || data.error || 'request_failed'
                let errorDetails = ''

                if (typeof fallbackError === 'string' && fallbackError.includes(':')) {
                    const parts = fallbackError.split(':')
                    fallbackError = parts[0].trim()
                    errorDetails = parts.slice(1).join(':').trim()
                }

                let translatedError = i18n.global.te(`api_errors.${fallbackError}`)
                    ? i18n.global.t(`api_errors.${fallbackError}`)
                    : fallbackError

                if (errorDetails) {
                    let detailParts = errorDetails.split(':')
                    let detailKey = detailParts[0].trim()
                    if (i18n.global.te(`api_errors.${detailKey}`)) {
                        detailParts[0] = i18n.global.t(`api_errors.${detailKey}`)
                        errorDetails = detailParts.join(': ')
                    }
                    translatedError = `${translatedError}: ${errorDetails}`
                }
                ElMessage.error(translatedError)
            }
            throw new Error(data.message || data.error || i18n.global.t('api_errors.request_failed'))
        }

        // 解构新的标准响应格式。如果后端返回 { success: true, data: [...] }，这里直接将 data 铺平返回，保持对原有旧代码的兼容性。
        // 或如果未被包装，直接 fallback 回 data 本身
        if (data.data !== undefined && Object.keys(data).includes('code')) {
            return { success: true, ...data.data }
        }

        return data
    } catch (error) {
        // 屏蔽被 silent 处理过的 Auth Error、OAuth 撤销信号、以及离线模式主动拦截的请求
        // isOffline 错误是系统主动拦截，不是真实网络故障，不应触发"网络错误"弹窗
        if (error.message !== 'Unauthorized/Forbidden' && !options.silent && !error.isOAuthRevoked && !error.isOffline) {
            console.error('API Request Error:', error)

            // Only show toast if it wasn't already shown in the !response.ok block above
            // The throwing logic above throws an Error with a specific format, we only toast here if it's a fetch/network level error
            if (error.name === 'TypeError' || error.message.includes('fetch') || error.name === 'AbortError') {
                ElMessage.error(i18n.global.te('api_errors.network_error') ? i18n.global.t('api_errors.network_error') : i18n.global.t('auth.network_abnormal'))
            }
        }
        throw error
    }
}