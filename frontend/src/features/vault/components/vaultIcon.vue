<template>
  <div class="service-icon-wrapper" :style="wrapperStyle">
    <div v-if="isLoading && !hasError" class="loading-spinner"></div>
    <img 
      v-if="winnerUrl && !hasError" 
      v-show="!isLoading"
      :src="winnerUrl" 
      class="service-icon-img" 
      @error="handleError"
      @load="handleLoad"
    />
    <div v-if="hasError && !isLoading" class="service-icon-fallback" :style="fallbackStyle">
      {{ firstLetter }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useVaultIconStore } from '../store/vaultIconStore'

/**
 * Logo 竞速加载机制 (Racing Mechanism) - 架构说明
 * ----------------------------------------------
 * 目的是在复杂网络环境下（墙、慢、离线）以最快速度展示出品牌图标，且不阻塞 UI。
 * 
 * 1. 缓存优先与即时探测 (Cache-First with Lazy Re-Race):
 *    - 优先从 `vaultIconStore` (Local Storage) 读取历史优胜者 URL 尝试秒开。
 *    - 若 1.2s 内缓存源未成功加载或报错，视作当前环境已失效，立即触发重赛。
 * 
 * 2. 延迟并发竞速 (Delayed Concurrency Race):
 *    - 若无缓存，先给“首选源” 2000ms 领先优势。
 *    - 若 2000ms 内未成功，立即开启“全源大逃杀”模式：对 Google、Bitwarden 并发请求。
 *    - 第一个 `Promise.any` 胜出且通过质量过滤的 URL 将被持久化为该域名的唯一优胜源。
 * 
 * 3. 伪图片过滤 (Quality Filtering):
 *    - 基于 `naturalWidth` 识别 API 返回的默认占位图（地球、1x1、16px图标等）。
 *    - 只有尺寸 > 18px 的真实图标才会被记入优胜，否则直接 Reject 寻找下一位。
 * 
 * 4. 离线与超时方案 (Safety & Fallback):
 *    - 多重定时器清理，确保内存安全。
 *    - 3s - 5s 绝对熔断，超时自动降级为“服务名首字母”背景。
 */
const iconStore = useVaultIconStore()

const props = defineProps({
  service: {
    type: String,
    default: ''
  },
  size: {
    type: Number,
    default: 32
  }
})

const hasError = ref(false)
const isLoading = ref(true)
const winnerUrl = ref('')
const raceTimeout = ref(null)
const cacheDetectTimeout = ref(null)

const handleLoad = (e) => {
  // 额外保障：即使是从缓存中读取的，如果尺寸命中占位图特征，则也触发错误状态并清理缓存
  const img = e.target;
  const isGooglePlaceholder = winnerUrl.value.includes('google') && img.naturalWidth === 16;
  const isBitwardenPlaceholder = winnerUrl.value.includes('bitwarden') && img.naturalWidth === 19;
  
  if (isGooglePlaceholder || isBitwardenPlaceholder) {
    console.warn(`[VaultIcon] Loaded icon found as placeholder (${img.naturalWidth}px), clearing cache...`);
    if (domainName.value) {
      iconStore.clearCachedIcon(domainName.value);
    }
    handleError();
    return;
  }

  isLoading.value = false
  clearTimeout(raceTimeout.value)
  clearTimeout(cacheDetectTimeout.value)
}

const handleError = () => {
  hasError.value = true
  isLoading.value = false
  clearTimeout(raceTimeout.value)
  clearTimeout(cacheDetectTimeout.value)
}

// 常用服务域名映射表
const SERVICE_DOMAIN_MAP = {
  'google': 'google.com',
  'github': 'github.com',
  'microsoft': 'microsoft.com',
  'apple': 'apple.com',
  'amazon': 'amazon.com',
  'facebook': 'facebook.com',
  'twitter': 'twitter.com',
  'discord': 'discord.com',
  'slack': 'slack.com',
  'telegram': 'telegram.org',
  'dropbox': 'dropbox.com',
  'cloudflare': 'cloudflare.com',
  'gitlab': 'gitlab.com',
  'bitbucket': 'bitbucket.org',
  'digitalocean': 'digitalocean.com',
  'heroku': 'heroku.com',
  'vercel': 'vercel.com',
  'netlify': 'netlify.com',
  'stripe': 'stripe.com',
  'paypal': 'paypal.com',
  'spotify': 'spotify.com',
  'netflix': 'netflix.com',
  'steam': 'steampowered.com'
}

const domainName = computed(() => {
  if (!props.service) return ''
  const s = props.service.toLowerCase().trim()
  if (s.includes('.')) return s
  return SERVICE_DOMAIN_MAP[s] || `${s}.com`
})

const firstLetter = computed(() => {
  return props.service ? props.service.charAt(0).toUpperCase() : ''
})


let raceIdCounter = 0

// 竞速逻辑实现
const startRace = async () => {
  const domain = domainName.value
  if (!domain) {
    isLoading.value = false
    hasError.value = false // 没 domain 时保持空白或由 template 处理，不报 Error
    return
  }

  // 每一个竞速任务分配一个 ID，防止异步竞争
  const raceId = ++raceIdCounter
  
  // 1. 检查缓存
  const cached = iconStore.getCachedIcon(domain)
  if (cached) {
    winnerUrl.value = cached
    // 🎉 核心优化：命中缓存说明之前大概率已经加载过，浏览器内存一定有。
    // 立即关闭加载状态，实现浮层挂载时的 0 毫秒秒开，彻底消灭拖拽抖动。
    isLoading.value = false
    hasError.value = false
    
    // 🛡️ 架构级防沉没机制（恢复）：
    // 虽然不显示加载圈，但我们在后方设置 2000ms (2s) 的暗哨。
    // 如果缓存地址失效（如在国内无法访问 google），2秒后 @load 尚未触发来清理这个定时器，
    // 我们认为这个缓存 URL 已死，立即触发全面重新竞速寻找其他可用源（如 Bitwarden）。
    cacheDetectTimeout.value = setTimeout(() => {
      if (raceId === raceIdCounter) {
        console.warn(`[VaultIcon] Cache response slow for ${domain}, starting backup race...`)
        performRace(domain, raceId)
      }
    }, 2000)
    return
  }

  // 2. 离线防爬：无缓存且处于离线状态，立刻走失败逻辑，不发起徒劳竞争
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    handleError()
    return
  }

  // 3. 无缓存记录，正常开启竞速
  performRace(domain, raceId)
}

const performRace = (domain, raceId) => {
  if (raceId !== raceIdCounter) return
  
  isLoading.value = true
  hasError.value = false

  const sources = [
    { name: 'google', url: `https://www.google.com/s2/favicons?domain=${domain}&sz=64` },
    { name: 'bitwarden', url: `https://icons.bitwarden.net/${domain}/icon.png` },
    { name: 'favicon', url: `https://favicon.im/zh/${domain}?throw-error-on-404=true` }
  ]

  let resolved = false
  const absoluteTimeout = 6000 // 加长熔断时间至 6s

  // 创建一个图片探测器
  const probe = (url, name) => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      
      const timer = setTimeout(() => {
        img.src = ''
        reject('timeout')
      }, 3000)

      img.onload = () => {
        clearTimeout(timer)
        // 关键逻辑：过滤伪成功
        // 1. 基本过滤：1x1 像素级占位或故障像素
        if (img.naturalWidth <= 1) {
          reject('placeholder_1x1')
          return
        }

        // 2. Google 专用：如果我们请求 64px 却返回 16px，说明是 Google 的默认地球图标
        if (name === 'google' && img.naturalWidth === 16) {
          console.warn(`[VaultIcon] Google returned default 16px globe for ${domain}`)
          reject('google_default')
          return
        }

        // 3. Bitwarden 专用：Bitwarden 的默认地球图标尺寸固定为 19x19
        if (name === 'bitwarden' && img.naturalWidth === 19) {
          console.warn(`[VaultIcon] Bitwarden returned default 19px globe for ${domain}`)
          reject('bitwarden_default')
          return
        }

        resolve(url)
      }
      img.onerror = () => {
        clearTimeout(timer)
        reject('network_error')
      }
      img.src = url
    })
  }

  const delayedRace = async () => {
    const preferredSource = sources[0] // 默认首选变回 Google，因为它覆盖最全

    const startRestOfRace = async () => {
      if (raceId !== raceIdCounter || resolved) return
      try {
        const promises = sources.map(s => probe(s.url, s.name))
        const winner = await Promise.any(promises)
        
        if (!resolved && raceId === raceIdCounter) {
          resolved = true
          winnerUrl.value = winner
          iconStore.setCachedIcon(domain, winner)
        }
      } catch (e) {
        if (!resolved && raceId === raceIdCounter) {
          console.error(`[VaultIcon] All race sources failed for ${domain}`)
          handleError()
        }
      }
    }

    try {
      // 这里的 Logic: 尝试首选源，如果 1500ms 没结果，就启动 startRestOfRace
      const preferredRes = await Promise.race([
        probe(preferredSource.url, preferredSource.name),
        new Promise((_, reject) => setTimeout(() => reject('timeout'), 1500))
      ])
      
      if (!resolved && raceId === raceIdCounter) {
        resolved = true
        winnerUrl.value = preferredRes
        iconStore.setCachedIcon(domain, preferredRes)
        handleLoad()
      }
    } catch (err) {
      startRestOfRace()
    }
  }

  delayedRace()

  // 最终熔断
  raceTimeout.value = setTimeout(() => {
    if (raceId === raceIdCounter && !resolved && isLoading.value) {
      console.error(`[VaultIcon] Race absolute timeout for ${domain}`)
      handleError()
    }
  }, absoluteTimeout)
}

onMounted(() => {
  startRace()
})

onBeforeUnmount(() => {
  clearTimeout(raceTimeout.value)
  clearTimeout(cacheDetectTimeout.value)
})

watch(() => props.service, () => {
  winnerUrl.value = ''
  isLoading.value = true
  hasError.value = false
  startRace()
})

const wrapperStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`
}))

const fallbackStyle = computed(() => {
  // 根据服务名生成固定的背景色
  const colors = [
    '#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399',
    '#7232dd', '#ee0a24', '#07c160', '#ff976a', '#1989fa'
  ]
  let hash = 0
  for (let i = 0; i < (props.service || '').length; i++) {
    hash = (props.service || '').charCodeAt(i) + ((hash << 5) - hash)
  }
  const color = colors[Math.abs(hash) % colors.length]
  
  return {
    backgroundColor: color,
    fontSize: `${Math.floor(props.size * 0.5)}px`
  }
})
</script>

<style scoped>
.service-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  overflow: hidden;
  background-color: var(--el-fill-color-lighter);
  flex-shrink: 0;
}

.service-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.service-icon-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0,0,0,0.1);
}

.loading-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--el-color-primary-light-7);
  border-top-color: var(--el-color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
