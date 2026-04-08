import { createApp } from 'vue'
import { logger } from '@/shared/utils/logger'
import { createPinia } from 'pinia'
import 'element-plus/dist/index.css'
import { registerSW } from 'virtual:pwa-register'
import 'element-plus/theme-chalk/dark/css-vars.css'
import '@/app/styles/main.css'
import '@/app/styles/dark.css'
import App from '@/app/app.vue'
import router from '@/app/router'
import { useThemeStore } from '@/shared/stores/themeStore'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { useVaultStore } from '@/features/vault/store/vaultStore'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { i18n } from '@/locales'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(i18n)

// 初始化主题状态
const themeStore = useThemeStore()
themeStore.initTheme()

// PWA Service Worker 注册
const updateSW = registerSW({
  immediate: true,
  onofflineReady() { },
  onNeedRefresh() {
    import('element-plus').then(({ ElNotification }) => {
      ElNotification({
        title: i18n.global.t('pwa.update_available') || 'Update Available',
        message: `
          <div style="line-height: 1.5; font-size: 14px; margin-bottom: 5px;">
            🎉 ${i18n.global.t('pwa.update_ready') || 'A new version is ready!'}
          </div>
          <div>
            <button 
              style="background: var(--el-color-primary); color: white; border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 13px;"
              id="pwa-refresh-btn"
            >
              ${i18n.global.t('pwa.pwa_refresh') || 'Refresh Now'}
            </button>
          </div>
        `,
        dangerouslyUseHTMLString: true,
        type: 'success',
        duration: 0
      })
      setTimeout(() => {
        const btn = document.getElementById('pwa-refresh-btn')
        if (btn) btn.onclick = () => updateSW(true)
      }, 100)
    })
  },
})

// ⚠️ 注意：router 的安装必须在 init() 完成之后
// 如果在这里提前 app.use(router)，router 会立即触发初始导航
// 此时 authUserStore.init() 尚未从 IDB 加载用户数据，导致闪现登录页
app.use(VueQueryPlugin, {
  queryClientConfig: {
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false, // 避免切换窗口时频繁请求列表
        staleTime: 1000 * 60 * 5 // 5分钟内数据视为新鲜，不自动重发请求
      }
    }
  }
})

const vaultStore = useVaultStore()
const authUserStore = useAuthUserStore()

// 🚀 先从 IDB 加载本地缓存状态，再安装路由 + 挂载应用
// 这样路由守卫拿到的 userInfo 是有效的，不会错误地跳到登录页
Promise.all([
  vaultStore.init(),
  authUserStore.init()
]).then(() => {
  // init 完成后再安装路由，确保 beforeEach 能读到正确的 userInfo
  app.use(router)
  app.mount('#app')
}).catch(err => {
  logger.error('[Main] Initialization failed:', err)
  // 如果初始化彻底失败（可能是 IDB 锁死），依然尝试挂载，
  // 这样至少可以展示渲染层，或是让路由等逻辑自行处理异常，避免在 splash 页面永久卡死
  app.use(router)
  app.mount('#app')
})