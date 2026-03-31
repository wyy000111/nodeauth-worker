import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useVaultStore } from '@/features/vault/store/vaultStore'
import { useVaultSyncStore } from '@/features/vault/store/vaultSyncStore'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { useAppLockStore } from '@/features/applock/store/appLockStore'
import { vaultService } from '@/features/vault/service/vaultService'
import { ElMessage } from 'element-plus'
import { getIdbItem, setIdbItem } from '@/shared/utils/idb'
import { i18n } from '@/locales'


/**
 * 离线就绪准备度检测 (Air-Gapped Readiness)
 * 拒绝“模拟”，拒绝“摆设”，实现真正的物理状态监控与全量资源拉取。
 */
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
            throw e // 🟢 抛出错误以使外部 downloadResources 能捕获并提示用户
        }
    }

    // 物理状态真机扫描
    const checkAll = async (force = false) => {
        // 🔒 架构锁：如果正在下载，禁止 checkAll 覆盖掉正在跳动的进度条 (除非 force 调用)
        if (isDownloading.value && !force) return

        // 1. 账号扫描：同时校验「加密数据是否存在」+「元数据记录的总数」
        try {
            // ☁️ 在线静默校准：如果在线，先偷偷问一下服务器目前到底有多少条，防止导入数据后的“虚假 100%”
            if (navigator.onLine) {
                try {
                    const headRes = await vaultService.getVault({ page: 1, limit: 1 })
                    if (headRes.success && headRes.pagination) {
                        const actualTotal = headRes.pagination.totalItems || headRes.pagination.total || 0
                        if (actualTotal > 0) {
                            await setIdbItem('vault:meta:server_total', actualTotal)
                        }
                    }
                } catch (apiErr) {
                    console.warn('[OfflineReadiness] Server total probe failed, using IDB cache', apiErr)
                }
            }

            const encryptedItems = await getIdbItem('vault:data:main')
            const localCount = await getIdbItem('vault:meta:local_count') || 0
            const serverTotal = await getIdbItem('vault:meta:server_total') || 0

            // 🔍 深度检测：不仅看有没有，还要看量对不对
            const isAccountsReady = encryptedItems && localCount > 0 && localCount >= serverTotal
            // 🏛️ 真实百分比退回：不再写死 90%，按照实际差量计算，让用户看到“确实缺了”
            status.value.accounts = isAccountsReady ? 100 : Math.floor((localCount / (serverTotal || 1)) * 100)
        } catch (e) {
            status.value.accounts = 0
        }


        // 2. 同步状态 (基于队列深度的动态反馈)
        const qLength = syncStore.syncQueue?.length || 0
        status.value.sync = qLength === 0 ? 100 : Math.max(0, 100 - qLength * 10)

        // 3. 静态资产物理检查 (WASM & Bundles)
        if ('caches' in window) {
            try {
                // 🏛️ 架构增强：主动探测逻辑 (Active Cache Probe)
                // 解决 Docker 环境下 Service Worker 缓存键名（带协议/不带协议）的不确性问题
                const activeCacheProbe = async (url) => {
                    try {
                        const response = await caches.match(url)
                        return !!response
                    } catch (e) { return false }
                }

                for (const name of cacheNames) {
                    const cache = await caches.open(name)
                    const keys = await cache.keys()
                    const urls = keys.map(k => k.url)

                    if (!foundWasm) {
                        foundWasm = urls.some(u => u.includes('argon2') || u.includes('sql-wasm'))
                    }
                    if (!foundMain) {
                        foundMain = urls.some(u => {
                            const l = u.toLowerCase().split('?')[0]
                            return l.includes('index-') ||
                                l.includes('main-') ||
                                l.includes('vue-core-') ||
                                l.includes('element-plus-') ||
                                l.endsWith('/index.html') ||
                                l.endsWith('/src/main.js') ||
                                l.includes('assets/index')
                        })
                        if (!foundMain) {
                            foundMain = urls.some(u => u.endsWith('/') || u.endsWith('/index.html'))
                        }
                    }
                    if (!foundAsset) {
                        if (name === 'nodeauth-assets-v1') {
                            foundAsset = urls.length > 0
                        } else {
                            foundAsset = urls.some(u => u.includes('.woff2') || u.includes('.png') || u.includes('.svg'))
                        }
                    }
                }

                // 🏛️ 建筑师终极回退：物理键名扫描失败后，进行主动探测
                if (!foundMain) foundMain = await activeCacheProbe('/') || await activeCacheProbe('/index.html')
                if (!foundWasm) foundWasm = await activeCacheProbe('/argon2.wasm') || await activeCacheProbe('/sql-wasm.wasm')

                status.value.engine = foundWasm ? 100 : 0
                status.value.components = foundMain ? 100 : 0
                status.value.assets = foundAsset ? 100 : 0
            } catch (e) {
                console.warn('[OfflineReadiness] Cache check failed', e)
            }
        }
    }


    // 触发真实资源拉取与持久化逻辑
    const downloadResources = async () => {
        if (isDownloading.value) return
        isDownloading.value = true

        try {
            // 🛡️ 架构师修复 (Self-Healing): 只要还有 Session，就尝试拉回 DeviceKey 续命
            let key = await appLockStore.getDeviceKey() // Changed from vaultStore.getDeviceKey()
            if (!key) {
                const authStore = useAuthUserStore()
                const restored = await authStore.fetchUserInfo()
                if (restored) {
                    key = await appLockStore.getDeviceKey() // Changed from vaultStore.getDeviceKey()
                }
            }

            if (!key) {
                throw new Error(i18n.global.t('security.auth_missing'))
            }

            // STEP 1: 账号数据深度同步 (分页流)
            // 🛡️ 架构关键：直接调用底层 request，绕过 vaultService 的双模判断逻辑
            // 下载资源本身就是"offline 模式下拿服务器数据"环节，必须强制走在线路径
            const PAGE_SIZE = 50
            let allItems = []

            const fetchPageFromAPI = async (page) => {
                // 🏛️ 架构关键：使用原生 fetch()，彻底绕过 request() 的离线模式拦截器
                // 下载资源是用户的主动授权行为，必须强制穿透 Air-Gapped 离线锁
                const params = new URLSearchParams({ page, limit: PAGE_SIZE, search: '', category: '' })

                // 读取 CSRF Token 保证请求合法性
                const csrfCookie = document.cookie.split('; ').find(c => c.startsWith('csrf_token='))
                const csrfToken = csrfCookie ? csrfCookie.split('=')[1] : ''

                const resp = await fetch(`/api/vault?${params.toString()}`, {
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
                    }
                })
                if (!resp.ok) throw new Error(`Vault API error: ${resp.status}`)
                return await resp.json()
            }

            const firstRes = await fetchPageFromAPI(1)
            if (firstRes.success) {
                // 🏛️ 架构修复：后端实际字段为 pagination.totalItems，不是 pagination.total
                // 这是导致只同步100条的终极根因：totalItems 未被读取 -> 降级到 vault.length=50
                const total = firstRes.pagination?.totalItems || firstRes.pagination?.total || firstRes.total || firstRes.vault?.length || 0
                allItems = [...(firstRes.vault || [])]

                console.log(`[OfflineReadiness] Total vault items to sync: ${total}, first page: ${allItems.length}`)

                if (total > allItems.length) {
                    status.value.accounts = Math.min(10, Math.floor((allItems.length / total) * 100))
                    const totalPages = Math.ceil(total / PAGE_SIZE)
                    console.log(`[OfflineReadiness] Will fetch ${totalPages} pages total`)

                    for (let p = 2; p <= totalPages; p++) {
                        const pageRes = await fetchPageFromAPI(p)
                        if (pageRes.success && pageRes.vault) {
                            allItems = [...allItems, ...pageRes.vault]
                            status.value.accounts = Math.min(99, Math.floor((allItems.length / total) * 100))
                            console.log(`[OfflineReadiness] Page ${p}/${totalPages} fetched, total collected: ${allItems.length}`)
                        }
                    }
                } else {
                    status.value.accounts = 99
                }

                // 物理保存到 IDB (加密落盘)
                await vaultStore.saveData({ vault: allItems, categoryStats: firstRes.categoryStats || [] })

                // 🏛️ 架构标记：存储物理统计指标，供离线检测扫描
                await setIdbItem('vault:meta:local_count', allItems.length)
                await setIdbItem('vault:meta:server_total', total)

                console.log(`[OfflineReadiness] Saved ${allItems.length}/${total} items to IDB ✅`)
                status.value.accounts = 100
            } else {
                throw new Error(i18n.global.t('security.vault_unreachable'))
            }


            // STEP 2: 安全引擎拉取 (WASM)
            const pwaCacheName = 'nodeauth-engine-v1'
            await fetchToCache('/argon2.wasm', pwaCacheName, 'engine')
            await fetchToCache('/sql-wasm.wasm', pwaCacheName, 'engine')

            // STEP 3: 静态资源显式落盘 + SW 更新
            // 不依赖 Workbox Precache（Dev 环境缺失），直接把已知资源托管到确定性 Cache
            const assetCacheName = 'nodeauth-assets-v1'
            await fetchToCache('/pwa-192x192.png', assetCacheName, 'assets')
            await fetchToCache('/pwa-512x512.png', assetCacheName, 'assets')
            // 附带触发 SW 更新，确保最新版本已被安装
            // 🛡️ 架构师修复：开发环境 (localhost) 的 dev-sw.js 常因 Vite 虚拟路径问题导致 update() 报 MIME 错误
            // 我们增加 try-catch 确保即使更新探测失败，也不影响后续 1.5s 后的物理检测
            if ('serviceWorker' in navigator && import.meta.env.PROD) {
                try {
                    const reg = await navigator.serviceWorker.getRegistration()
                    if (reg) await reg.update()
                } catch (swErr) {
                    console.warn('[OfflineReadiness] Service Worker update skipped or failed:', swErr)
                }
            }
            status.value.components = 100

            // 最终刷新全盘物理状态并做终极校验
            // 🛡️ 架构师决策：等待 1.5 秒确保 Service Worker 已经从网卡写入了 Disk (磁盘)
            await new Promise(r => setTimeout(r, 1500))
            await checkAll(true)

            const totalReady = Object.values(status.value).every(v => v === 100)
            if (!totalReady) {
                ElMessage.warning(i18n.global.t('security.sync_partial'))
            }

        } catch (e) {
            console.error('[OfflineReadiness] Download failed:', e)
            ElMessage.error(e.message || i18n.global.t('security.sync_failed'))
            // 💡 架构决策：不重置进度到 0，保留现有 UI 反馈，由 checkAll 下一次自然纠偏
        } finally {
            isDownloading.value = false
        }
    }

    // 周期监视
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
        canEnableOffline: computed(() => {
            return Object.values(status.value).every(v => v === 100)
        }),
        checkAll,
        downloadResources
    }
}
