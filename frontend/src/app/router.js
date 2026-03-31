import { createRouter, createWebHistory } from 'vue-router'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { createAsyncComponent } from '@/shared/utils/asyncHelper'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: createAsyncComponent(() => import('@/features/home/views/home.vue')),
    meta: { requiresAuth: true } // 需要登录才能访问
  },
  {
    path: '/login',
    name: 'Login',
    component: createAsyncComponent(() => import('@/features/auth/views/login.vue')),
    meta: { guestOnly: true } // 仅限游客访问 (已登录会自动跳转首页)
  },
  {
    path: '/oauth/callback', // 统一的回调路径 (GitHub, Telegram, etc.)
    name: 'OAuthCallback',
    component: createAsyncComponent(() => import('@/features/auth/views/oauthCallback.vue')),
    meta: { requiresAuth: false }
  },



  {
    path: '/callback/:provider', // 兼容特定 Provider 的回调路径 (如 /callback/telegram)
    name: 'ProviderCallback',
    component: createAsyncComponent(() => import('@/features/auth/views/oauthCallback.vue')),
    meta: { requiresAuth: false }
  },



  {
    path: '/health',
    name: 'HealthCheck',
    component: createAsyncComponent(() => import('@/features/health/views/healthCheck.vue')),
    meta: { guestOnly: false, requiresAuth: false }
  },
  {
    path: '/emergency',
    name: 'Emergency',
    component: createAsyncComponent(() => import('@/features/emergency/views/emergency.vue')),

    meta: { requiresAuth: true, skipPinLock: true }

  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫：乐观优先策略 (Optimistic-First Navigation)
// 核心：用本地 IDB 缓存状态做即时决策，后台异步验证 Session 有效性
router.beforeEach(async (to) => {
  const authUserStore = useAuthUserStore()

  // 直接用内存中的状态判断（由 main.js 中 authUserStore.init() 从 IDB 加载，无需等待网络）
  const isAuthenticated = !!(authUserStore.userInfo && authUserStore.userInfo.id)

  // 权限判定 (基于本地缓存，瞬时完成)
  // 情况 A: 需要授权但本地无缓存 -> 踢到登录页
  if (to.meta.requiresAuth && !isAuthenticated) {
    return '/login'
  }

  // 情况 B: 仅游客可看但本地有缓存 -> 踢回主页
  if (to.meta.guestOnly && isAuthenticated) {
    return '/'
  }

  // 情况 C: 业务逻辑校验
  if (isAuthenticated) {
    if (authUserStore.needsEmergency && to.path !== '/emergency') {
      return '/emergency'
    }
    if (!authUserStore.needsEmergency && to.path === '/emergency') {
      return '/'
    }
  }

  // 后台异步验证：仅首次导航时触发，不阻塞路由渲染
  // isInitialized 由 main.js 的 init() 控制初始状态，这里仅做一次服务端校验
  if (!authUserStore.isInitialized && (to.meta.requiresAuth || to.meta.guestOnly)) {
    authUserStore.startVerifying()  // 通知 UI 显示 Loading
    authUserStore.fetchUserInfo().then((loggedIn) => {
      authUserStore.markInitialized()
      authUserStore.stopVerifying()  // 关闭 Loading
      // Session 已过期：踢到登录页
      if (!loggedIn && to.meta.requiresAuth) {
        router.replace('/login')
      }
      // Session 有效但处于游客页面：踢回主页
      if (loggedIn && to.meta.guestOnly) {
        router.replace('/')
      }
    }).catch(() => {
      authUserStore.markInitialized()
      authUserStore.stopVerifying()  // 即便网络失败也关闭 Loading，避免永久转圈
    })
  } else {
    // 无需验证或已完成验证的路由，确保 isInitialized 已标记
    if (!authUserStore.isInitialized) {
      authUserStore.markInitialized()
    }
  }

  return true
})

// == 核心异常拦截机制 (Graceful Error Boundary) ==
// 拦截因离线或更新导致的分包 (Chunk) 加载失败，避免出现白屏死机
router.onError((error, to) => {
  console.error('Router navigation error:', error)
  const isChunkLoadFailed = error.message.match(/Failed to fetch dynamically imported module/i) ||
    error.message.match(/Importing a module script failed/i) ||
    error.message.match(/Loading chunk/i);

  if (isChunkLoadFailed) {
    if (navigator.onLine) {
      // 用户在线，发生此错误通常是因为后端刚刚发版，旧缓存关联的 Chunk hash 失效了
      // 直接强制刷新页面可以获取最新的 index.html 和新的 Chunk 映射
      window.location.reload()
    } else {
      // 离线状态下，用户点击了一个未曾预热缓存按需加载的大组件 (如数据导出、数据迁移等)
      import('element-plus').then(({ ElMessageBox }) => {
        import('@/locales').then(({ i18n }) => {
          ElMessageBox.alert(
            i18n.global.t('pwa.offline_feature_error_desc') || 'The advanced feature requires a network connection to download its necessary components for the first time. Please connect to the internet and try again.',
            i18n.global.t('pwa.offline_feature_error_title') || 'Network Required',
            {
              confirmButtonText: i18n.global.t('common.confirm') || 'OK',
              type: 'warning',
              center: true
            }
          )
        })
      })
    }
  }
})

export default router