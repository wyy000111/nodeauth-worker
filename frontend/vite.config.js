// frontend/vite.config.js
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { execSync } from 'child_process'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import fs from 'node:fs'
import path from 'node:path'

let commitHash = ''
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim()
} catch (e) {
  commitHash = 'unknown'
}

// 读取根目录 package.json 版本
const pkgPath = path.resolve(__dirname, '../package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
const appVersion = pkg.version || '0.0.0'
const isDocker = process.env.DOCKER_BUILD === 'true'
const appPlatform = isDocker ? 'Docker' : 'Cloudflare Workers'
const iconSuffix = isDocker ? 'docker' : 'cloudflare'

export default defineConfig({
  plugins: [
    vue(),
    wasm(),
    topLevelAwait(),
    AutoImport({
      imports: ['vue', 'vue-router'],
      resolvers: [ElementPlusResolver({ importStyle: false })],
    }),
    Components({
      resolvers: [
        ElementPlusResolver({
          importStyle: false,
        }),
      ],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'logo.svg', `pwa-${iconSuffix}-192x192.png`, `pwa-${iconSuffix}-512x512.png`],
      manifest: {
        id: '/',
        name: 'NodeAuth',
        short_name: 'NodeAuth',
        description: 'A Secure 2FA Management Tool',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['utilities', 'security'],
        icons: [
          {
            src: `pwa-${iconSuffix}-192x192.png?20260401`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: `pwa-${iconSuffix}-512x512.png?20260401`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: `pwa-${iconSuffix}-512x512.png?20260401`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        globIgnores: [
          '**/assets/wa-sqlite*.js',
          '**/assets/argon2*.js',
          '**/assets/hash-wasm*.js',
          '**/assets/libsodium-wrappers*.js',
          '**/assets/sql*.js',
          '**/assets/jsQR*.js',
          '**/assets/pdf-utils*.js',
          '**/assets/compression-utils*.js',
          '**/assets/dataImport*.js',
          '**/assets/dataMigrationService*.js',
          '**/assets/openpgp*.js',
          '**/assets/web3-vendor*.js'
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        // 排除 API 和 Vite 开发环境下的内部路径，防止 Service Worker 拦截干扰
        navigateFallbackDenylist: [
          /^\/api/,
          /\/@vite\//,
          /\/@fs\//,
          /\/@id\//,
          /node_modules/
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api'),
            handler: 'NetworkOnly'
          },
          {
            // 为大体积、非高频访问的 WASM 文件配置动态缓存
            urlPattern: /\.wasm$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'wasm-dynamic-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 30 * 24 * 60 * 60 // 30 天
              }
            }
          },
          {
            // 为被 globIgnores 忽略的大体积工具 JS chunk 配置动态缓存
            urlPattern: /assets\/(wa-sqlite|argon2|hash-wasm|libsodium-wrappers|sql|jsQR|pdf-utils|compression-utils|dataImport|dataMigrationService|openpgp|web3-vendor).*\.js$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lazy-tools-js-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 30 * 24 * 60 * 60
              }
            }
          },
          {
            // 外部服务品牌图标永久缓存策略 (Workbox PWA)
            urlPattern: /^https:\/\/(www\.google\.com\/s2|icons\.bitwarden\.net)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'service-icons-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 30 * 24 * 60 * 60 // 30天
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_PLATFORM__: JSON.stringify(appPlatform),
    'import.meta.env.VITE_LOG_LEVEL': JSON.stringify(process.env.VITE_LOG_LEVEL || 'warn')
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    },
    fs: {
      allow: ['..']
    }
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // 精确匹配 Vue 与其核心生态相关包
            if (
              id.includes('/node_modules/vue/') ||
              id.includes('/node_modules/@vue/') ||
              id.includes('/node_modules/vue-router/') ||
              id.includes('/node_modules/pinia/')
            ) {
              return 'vue-core'
            }

            // 精确匹配 Element Plus 及其底层依赖
            if (
              id.includes('/node_modules/element-plus/') ||
              id.includes('/node_modules/@element-plus/')
            ) {
              return 'element-plus'
            }

            // 加密与数据库相关的超大模块抽象为主 Vendor Chunk
            if (id.includes('/node_modules/wa-sqlite/')) return 'wa-sqlite'
            if (id.includes('/node_modules/argon2-browser/')) return 'argon2-browser'
            if (id.includes('/node_modules/hash-wasm/')) return 'hash-wasm'
            if (id.includes('/node_modules/libsodium-wrappers/') || id.includes('/node_modules/libsodium-wrappers-sumo/')) return 'libsodium-wrappers'
            if (id.includes('/node_modules/sql.js/')) return 'sql-js'

            // 新增：通行密钥 (Passkey) 相关
            if (id.includes('/node_modules/@simplewebauthn/')) return 'simplewebauthn'

            // 新增：PDF 生成与压缩相关 (体积较大且仅特定场景使用)
            if (id.includes('/node_modules/jspdf/') || id.includes('/node_modules/html2canvas/')) return 'pdf-utils'
            if (id.includes('/node_modules/fflate/')) return 'compression-utils'

            // 二维码处理相关 (体积较大且仅特定页面使用)
            if (id.includes('/node_modules/qrcode/') || id.includes('/node_modules/jsqr/')) return 'qr-utils'

            // 加密相关：OpenPGP (体积大且仅特定导入场景使用)
            if (id.includes('/node_modules/openpgp/')) return 'openpgp'

            // 大型 UI 支撑库
            if (id.includes('/node_modules/@tanstack/')) return 'tanstack-query'

            // Web3 / WalletConnect 相关核心大包装进独立 chunk
            if (id.includes('/node_modules/@walletconnect/') || id.includes('/node_modules/viem/')) return 'web3-vendor'

            // 剩余其他的第三方包交给 Rollup 按需路由或组件自动拆分 (移除强硬的 'vendor' 返回)
          }
        }
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.{test,spec}.js'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
})
