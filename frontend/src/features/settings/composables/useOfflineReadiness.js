import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useVaultStore } from '@/features/vault/store/vaultStore'
import { useVaultSyncStore } from '@/features/vault/store/vaultSyncStore'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { useAppLockStore } from '@/features/applock/store/appLockStore'
import { ElMessage } from 'element-plus'
import { getIdbItem, setIdbItem } from '@/shared/utils/idb'
import { i18n } from '@/locales'
import { OFFLINE_RESOURCES } from '@/shared/services/offlineRegistry'

export function useOfflineReadiness() {
    const vaultStore = useVaultStore()
    const appLockStore = useAppLockStore()
    const syncStore = useVaultSyncStore()

    const status = ref({
        accounts: 0,
        components: 0,
        engine: 0,
        assets: 0,
        sync: 0
    })

    const isDownloading = ref(false)
    let checkTimer = null

    // 辅助函数：带进度的下载并写入缓存
    const fetchToCache = async (url, cacheName, statusKey) => {
        try {
            const cache = await caches.open(cacheName)
            if (await cache.match(url)) return true // 防止重复拉取

            const response = await fetch(url)
            if (!response.ok) throw new Error(`Fetch failed for ${url}: ${response.statusText}`)

            const reader = response.body.getReader()
            const contentLength = +response.headers.get('Content-Length')

            let receivedLength = 0
            const chunks = []

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                chunks.push(value)
                receivedLength += value.length
                if (contentLength && contentLength > 0) {
                    status.value[statusKey] = Math.min(99, Math.floor((receivedLength / contentLength) * 100))
                }
            }

            const blob = new Blob(chunks)
            const newRes = new Response(blob, {
                headers: response.headers,
                status: response.status,
                statusText: response.statusText
            })

            await cache.put(url, newRes)
            status.value[statusKey] = 100
            return true
        } catch (e) {
            console.error(`[OfflineReadiness] Failed to cache ${url}:`, e)
            throw e
        }
    }

    // 🏛️ 物理状态真机扫描 (Deep Asset Scanner via Universal Registry)
    const checkAll = async (force = false) => {
        if (isDownloading.value && !force) return

        // --- 1. 账号扫描 ---
        try {
            const localCount = await getIdbItem('vault:meta:local_count') || 0
            const serverTotal = await getIdbItem('vault:meta:server_total') || 0
            const isAccountsReady = localCount > 0 && localCount >= serverTotal
            status.value.accounts = isAccountsReady ? 100 : Math.floor((localCount / (serverTotal || 1)) * 100)
        } catch (e) { status.value.accounts = 0 }

        // --- 2. 同步状态 (Sync Queue) ---
        const qLength = syncStore.syncQueue?.length || 0
        status.value.sync = qLength === 0 ? 100 : Math.max(0, 100 - qLength * 10)

        // --- 3. 物理缓存扫描 ---
        if ('caches' in window) {
            try {
                const allCacheNames = await caches.keys()
                const activeCacheProbe = async (url) => {
                    try { return !!(await caches.match(url)) } catch (e) { return false }
                }

                // 中心化探测集 (基于 Registry)
                const probeStatus = {
                    SECURITY: OFFLINE_RESOURCES.SECURITY.map(r => ({ ...r, found: false })),
                    UTILITIES: OFFLINE_RESOURCES.UTILITIES.map(r => ({ ...r, found: false })),
                    ENGINES: OFFLINE_RESOURCES.ENGINES.map(r => ({ ...r, found: false }))
                };

                // 🔍 获取已验证的真实路径清单 (从 IDB)
                const verifiedPaths = await getIdbItem('offline:verified_paths') || {};

                const matchResource = (r, urls) => {
                    // 1. 优先使用已验证的运行时状态标记 (彻底摆脱探测打包资源文件名的强耦合)
                    if (verifiedPaths[r.name] === '__VERIFIED_RUNTIME__') {
                        return true;
                    }
                    // 2. 兜底使用严格关键字匹配 (通常仅用于老版本残留缓存扫描)
                    const probes = (r.probes || [r.probe]).filter(p => p !== 'vendor-');
                    return urls.some(u => {
                        const lowU = u.toLowerCase();
                        return (r.url && lowU.includes(r.url.toLowerCase())) ||
                            probes.some(p => lowU.includes(p.toLowerCase()));
                    });
                };

                let foundMain = false
                let foundIcons = false
                let foundFonts = false

                for (const name of allCacheNames) {
                    const cache = await caches.open(name)
                    const keys = await cache.keys()
                    const urls = keys.map(k => k.url.toLowerCase().split('?')[0])

                    // 执行全量探测匹配
                    for (const cat in probeStatus) {
                        probeStatus[cat].forEach(r => {
                            if (!r.found && matchResource(r, urls)) {
                                r.found = true;
                            }
                        })
                    }

                    if (!foundMain) {
                        foundMain = urls.some(u =>
                            u.includes('index-') || u.includes('main-') || u.includes('vue-core-') ||
                            u.includes('element-plus-') || u.endsWith('/index.html') || u.includes('assets/index')
                        )
                    }
                    if (!foundIcons) foundIcons = urls.some(u => u.includes('pwa-') && (u.includes('.png') || u.includes('.svg')))
                    if (!foundFonts) foundFonts = urls.some(u => u.includes('.woff2'))
                }

                // 🏗️ 自动感知逻辑：如果当前所有样式表中都没有定义 .woff2，则自动视为“字体已就绪”
                if (!foundFonts) {
                    const hasFontDefinitions = Array.from(document.styleSheets).some(sheet => {
                        try {
                            return Array.from(sheet.cssRules || []).some(rule => rule.cssText?.includes('.woff2'))
                        } catch (e) { return false }
                    })
                    if (!hasFontDefinitions) foundFonts = true // 无需外部字体，自动满分
                }

                // 物理探测回退
                if (!foundMain) foundMain = await activeCacheProbe('/') || await activeCacheProbe('/index.html')

                // 🛡️ 环境自适应逻辑
                const host = window.location.hostname
                const isLocalDev = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.')

                // 🔴 安全引擎评分逻辑：
                // 引擎权重(40%) + 辅助安全库(60%)
                const foundEngineCount = probeStatus.ENGINES.filter(r => r.found).length
                const foundSecurityLibCount = probeStatus.SECURITY.filter(r => r.found).length
                const engineScore = Math.floor((foundEngineCount / probeStatus.ENGINES.length) * 40) +
                    Math.floor((foundSecurityLibCount / probeStatus.SECURITY.length) * 60)
                status.value.engine = isLocalDev ? 100 : engineScore

                // 🔵 核心组件得分
                status.value.components = (foundMain || isLocalDev) ? 100 : 0

                // 🟡 静态资源评分：
                // 图标(40%) + 字体(10%) + 迁移工具库(50%)
                const foundUtilsCount = probeStatus.UTILITIES.filter(r => r.found).length
                const assetScore = (foundIcons ? 40 : 0) + (foundFonts ? 10 : 0) +
                    Math.floor((foundUtilsCount / probeStatus.UTILITIES.length) * 50)
                status.value.assets = isLocalDev ? 100 : assetScore

            } catch (e) {
                console.warn('[OfflineReadiness] Cache scanner failed', e)
            }
        }
    }

    // 🚀 触发资源预拉取
    const downloadResources = async () => {
        if (isDownloading.value) return
        if (!('caches' in window) || !window.caches) {
            ElMessage.error(i18n.global.t('security.insecure_context_blocked') || '当前环境不支持缓存 (请使用 HTTPS 或 localhost)');
            return
        }
        isDownloading.value = true

        try {
            // STEP 1: 权限续期
            let key = await appLockStore.getDeviceKey()
            if (!key) {
                const authStore = useAuthUserStore()
                const restored = await authStore.fetchUserInfo()
                if (restored) key = await appLockStore.getDeviceKey()
            }
            if (!key) throw new Error(i18n.global.t('security.auth_missing'))

            // STEP 2: 数据分页深度拉取
            const PAGE_SIZE = 50
            const fetchPageFromAPI = async (page) => {
                const params = new URLSearchParams({ page, limit: PAGE_SIZE })
                const csrfCookie = document.cookie.split('; ').find(c => c.startsWith('csrf_token='))
                const csrfToken = csrfCookie ? csrfCookie.split('=')[1] : ''
                const resp = await fetch(`/api/vault?${params.toString()}`, {
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }
                })
                if (!resp.ok) throw new Error(`Vault API error: ${resp.status}`)
                return await resp.json()
            }

            const firstRes = await fetchPageFromAPI(1)
            if (firstRes.success) {
                const total = firstRes.pagination?.totalItems || firstRes.pagination?.total || firstRes.total || firstRes.vault?.length || 0
                let allItems = [...(firstRes.vault || [])]
                if (total > allItems.length) {
                    const totalPages = Math.ceil(total / PAGE_SIZE)
                    for (let p = 2; p <= totalPages; p++) {
                        const pageRes = await fetchPageFromAPI(p)
                        if (pageRes.success && pageRes.vault) {
                            allItems = [...allItems, ...pageRes.vault]
                            status.value.accounts = Math.min(99, Math.floor((allItems.length / total) * 100))
                        }
                    }
                }
                await vaultStore.saveData({ vault: allItems, categoryStats: firstRes.categoryStats || [] })
                await setIdbItem('vault:meta:local_count', allItems.length)
                await setIdbItem('vault:meta:server_total', total)
                status.value.accounts = 100
            }

            // STEP 3 & 4: 🛡️ 中心化资源下载逻辑 (Security Libs, Utilities, Engines)
            const pwaCacheName = 'nodeauth-engine-v1'

            // A. 批量下载 WASM 层
            for (const engine of OFFLINE_RESOURCES.ENGINES) {
                if (engine.url) await fetchToCache(engine.url, pwaCacheName, 'engine')
            }

            // STEP B: 触发所有动态库的预拉取，落盘防篡改标记
            console.log('[OfflineReadiness] Preparing Registry libraries...');
            const verifiedPaths = await getIdbItem('offline:verified_paths') || {};

            const loadAndCapture = async (resource) => {
                await resource.loader();
                // 只要成功运行并在内存解析，Workbox/Service Worker 将全权负责其持久化缓存
                // 抛弃对 performance network entries 的正则猜测，使用绝对状态位
                verifiedPaths[resource.name] = '__VERIFIED_RUNTIME__';
            };

            const allLoaders = [
                ...OFFLINE_RESOURCES.SECURITY.map(r => loadAndCapture(r)),
                ...OFFLINE_RESOURCES.UTILITIES.map(r => loadAndCapture(r))
            ];
            const loadResults = await Promise.allSettled(allLoaders);
            await setIdbItem('offline:verified_paths', verifiedPaths);

            if (loadResults.some(r => r.status === 'rejected')) {
                throw new Error(i18n.global.t('security.sync_failed') || 'Some offline resources failed to download');
            }

            // C. 静态资源深度同步 (PWA 图标 & 字体)
            const assetCacheName = 'nodeauth-assets-v1'

            // 1. 同步图标
            const iconVariants = ['/pwa-192x192.png', '/pwa-512x512.png', '/logo.svg', '/favicon.svg']
            for (const iconUrl of iconVariants) {
                try { await fetchToCache(iconUrl, assetCacheName, 'assets') } catch (e) { }
            }

            // 2. 同步字体（显式尝试常见路径，防止 Rollup 混淆导致漏抓）
            // Vite 打包后的字体通常在 /assets/ 目录下，通过扫描 index.css 也可以发现它们
            const fontUrlRaw = Array.from(document.styleSheets)
                .flatMap(sheet => {
                    try { return Array.from(sheet.cssRules) } catch (e) { return [] }
                })
                .filter(rule => rule.cssText?.includes('url(') && rule.cssText?.includes('.woff2'))
                .map(rule => {
                    const match = rule.cssText.match(/url\(['"]?([^'"]+\.woff2)/)
                    return match ? match[1] : null
                })
                .filter(Boolean);

            for (const fUrl of fontUrlRaw) {
                try { await fetchToCache(fUrl, assetCacheName, 'assets') } catch (e) { }
            }
            status.value.assets = 100

            // STEP 6: 触发 Service Worker 强制同步并最终核实
            if ('serviceWorker' in navigator && import.meta.env.PROD) {
                const reg = await navigator.serviceWorker.getRegistration()
                if (reg) await reg.update()
            }

            // 🏛️ 等待物理缓存刷新并执行首轮重新扫描
            await new Promise(r => setTimeout(r, 1500))
            await checkAll(true)
        } catch (e) {
            console.error('[OfflineReadiness] Download Error:', e)
            ElMessage.error(e.message || i18n.global.t('security.sync_failed'))
        } finally {
            isDownloading.value = false
        }
    }

    onMounted(() => {
        checkAll()
        checkTimer = setInterval(checkAll, 5000)
    })
    onUnmounted(() => { if (checkTimer) clearInterval(checkTimer) })

    return {
        status,
        overallProgress: computed(() => {
            const values = Object.values(status.value)
            return Math.floor(values.reduce((a, b) => a + b, 0) / values.length)
        }),
        isDownloading,
        canEnableOffline: computed(() => Object.values(status.value).every(v => v === 100)),
        checkAll,
        downloadResources
    }
}
