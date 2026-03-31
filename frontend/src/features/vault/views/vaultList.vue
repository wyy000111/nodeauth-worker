<template>
  <div class="vault-list-wrapper min-h-400">
    <!-- 🟢 全局离线同步状态条 -->
    <transition name="el-zoom-in-top">
      <div v-if="syncStore.hasPendingChanges" class="offline-sync-banner px-16 py-8 mb-10">
        <el-icon class="mr-8"><Upload /></el-icon>
        <span class="text-12">{{ $t('vault.offline_pending_sync', { count: syncStore.syncQueue.length }) }}</span>
      </div>
    </transition>

    <div class="vault-content">
      <!-- 固定的操作栏与分类筛选 -->
      <el-affix 
        :offset="layoutStore.isMobile ? 58 : 60" 
        :disabled="layoutStore.isMobile && selectedIds.length === 0"
        @change="(val) => isToolbarFixed = val"
      >
        <div class="affix-container" :class="{ 'is-affixed': isToolbarFixed }">
          <!-- 移动端：仅在有选中项时显示批量操作 -->
          <div v-if="layoutStore.isMobile && selectedIds.length > 0" class="vault-list-toolbar mb-10 flex gap-15 flex-items-center flex-between px-16 py-12">
            <div class="batch-actions flex flex-items-center gap-10 flex-1">
              <span class="batch-text">{{ $t('search.selected_items', { count: selectedIds.length }) }}</span>
              <div class="flex-1"></div>
              <el-button size="small" @click="selectAllLoaded" plain :disabled="isBulkDeleting">{{ $t('search.select_all_loaded') }}</el-button>
              <el-button type="danger" plain size="small" @click="handleBulkDelete" :loading="isBulkDeleting">
                <el-icon><Delete /></el-icon>
              </el-button>
              <el-button size="small" @click="selectedIds = []" plain :disabled="isBulkDeleting">{{ $t('common.cancel') }}</el-button>
            </div>
          </div>

          <div v-if="!layoutStore.isMobile" class="vault-list-toolbar mb-10 flex gap-15 flex-items-center flex-between flex-wrap">
            <div class="flex flex-items-center gap-10 flex-1">
              <el-input 
                v-model="searchQuery" 
                :placeholder="$t('search.placeholder')" 
                clearable 
                class="max-w-400"
              >
                <template #prefix>
                  <el-icon v-if="isFetching && searchQuery" class="is-loading"><Loading /></el-icon>
                  <el-icon v-else><Search /></el-icon>
                </template>
              </el-input>
            </div>
            
            <div class="batch-actions flex flex-items-center gap-10">
              <template v-if="selectedIds.length > 0">
                <span class="batch-text">{{ $t('search.selected_items', { count: selectedIds.length }) }}</span>
                <el-button type="danger" plain @click="handleBulkDelete" :loading="isBulkDeleting">
                  <el-icon><Delete /></el-icon> {{ $t('common.delete') }}
                </el-button>
                <el-button @click="selectedIds = []" plain :disabled="isBulkDeleting">{{ $t('common.cancel') }}</el-button>
              </template>
              <el-button v-else @click="selectAllLoaded" plain :disabled="isBulkDeleting">{{ $t('search.select_all_loaded') }}</el-button>

              <!-- PC端 视图切换器 (标准分段控件) -->
              <el-radio-group 
                v-model="layoutStore.appVaultViewMode" 
                class="ml-10"
                @change="layoutStore.setVaultViewMode"
              >
                <el-radio-button v-for="opt in viewModeOptions" :key="opt.value" :label="opt.value">
                  <el-icon size="16"><component :is="opt.icon" /></el-icon>
                </el-radio-button>
              </el-radio-group>
            </div>
          </div>

          <!-- 只有在非搜索模式或 PC 端显示分类 -->
          <div class="category-filter-container" v-if="!isInitializing && (!layoutStore.isMobile || !layoutStore.isSearchVisible)">
            <div class="category-chips">
              <div
                class="category-tag"
                :class="{ 
                  'is-active': selectedCategory === '',
                  'is-loading': isFetching && selectedCategory === '' && !isFetchingNextPage
                }"
                @click="selectedCategory = ''"
              >
                {{ $t('common.all') }}
                <span class="tag-count">({{ absoluteTotalItems }})</span>
                <!-- 独立加载轨道，避免截断文字 -->
                <div v-if="isFetching && selectedCategory === '' && !isFetchingNextPage" class="tag-loading-track">
                  <div class="tag-loading-bar"></div>
                </div>
              </div>
              <div
                v-for="stat in categoryStats"
                :key="stat.id"
                class="category-tag"
                :class="{ 
                  'is-active': selectedCategory === stat.id,
                  'is-loading': isFetching && selectedCategory === stat.id && !isFetchingNextPage
                }"
                @click="selectedCategory = stat.id"
              >
                {{ stat.category || $t('common.uncategorized') }}
                <span class="tag-count">({{ stat.count }})</span>
                <div v-if="isFetching && selectedCategory === stat.id && !isFetchingNextPage" class="tag-loading-track">
                  <div class="tag-loading-bar"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </el-affix>

      <!-- 1. 加载中 -->
      <div v-if="isInitializing || (isLoading && vault.length === 0)" class="flex-column flex-center min-h-400 text-secondary">
        <el-icon class="is-loading mb-20 text-primary" :size="48"><Loading /></el-icon>
        <p class="text-16 ls-1">{{ $t('common.loading_data') }}</p>
      </div>

      <!-- 2. 完全空状态 -->
      <div v-else-if="!isLoading && !isFetching && vault.length === 0 && !searchQuery" class="empty-state">
        <el-empty :description="$t('vault.empty_vault')">
          <el-button type="primary" @click="$emit('switch-tab', 'add-vault')">{{ $t('vault.go_add_vault') }}</el-button>
        </el-empty>
      </div>

      <div v-else
        class="list-container min-h-200"
        v-infinite-scroll="handleLoadMore"
        :infinite-scroll-disabled="isLoadMoreDisabled"
        :infinite-scroll-distance="300"
      >
        <DynamicScroller
          class="vault-scroller"
          page-mode
          :items="gridRows"
          :min-item-size="80"
          key-field="id"
        >
          <template v-slot="{ item: row, index, active }">
            <DynamicScrollerItem
              :item="row"
              :active="active"
              :size-dependencies="[row.items]"
              :data-index="index"
            >
              <el-row :gutter="20">
                <el-col 
                  v-for="(vaultItem, idx) in row.items" 
                  :key="idx"
                  v-bind="colProps"
                  :class="[layoutStore.appVaultViewMode === 'compact' ? 'mb-15' : 'mb-20']"
                  :data-id="vaultItem.id"
                >
                  <VaultItemCard 
                     :item="vaultItem"
                     :is-selected="selectedIds.includes(vaultItem.id)"
                     :is-dragging="draggedId === vaultItem.id"
                     :is-pressing="isPressing === vaultItem.id"
                     :is-compact="layoutStore.appVaultViewMode === 'compact'"
                     :is-pending="syncStore.isItemPending(vaultItem.id) || vaultItem.pending"
                     :is-mobile="layoutStore.isMobile"
                     @toggle-selection="toggleSelection"
                     @command="handleCommand"
                     @copy-code="copyCode"
                     @resolve-conflict="handleResolveConflict"
                     @mousedown="handleMouseDown($event, vaultItem.id)"
                     @touchstart="handleTouchStart($event, vaultItem.id)"
                  />
                </el-col>
              </el-row>
            </DynamicScrollerItem>
          </template>
        </DynamicScroller>

        <!-- 极致镜像 Teleport 浮层 (同样对齐样式) -->
        <teleport to="body">
          <div 
            v-if="draggedId && draggedItem" 
            class="drag-floating-card"
            :style="floatingStyle"
          >
            <!-- 在浮层中，卡片应显示为其原本完美的非拖拽阴影状态 -->
            <VaultItemCard 
               style="pointer-events: none;"
               :item="draggedItem"
               :is-compact="layoutStore.appVaultViewMode === 'compact'"
               :is-dragging="false"
            />
          </div>
        </teleport>

        <div v-if="isFetchingNextPage" class="text-center p-20 text-secondary">
          <el-icon class="is-loading"><Loading /></el-icon> {{ $t('vault.loading_more') }}
        </div>
        <div v-if="!hasNextPage && vault.length > 0" class="text-center p-20 text-secondary text-12">
          {{ $t('vault.no_more_accounts') }}
        </div>
        <el-empty v-if="!isLoading && vault.length === 0 && searchQuery" :description="$t('search.no_matching_accounts')" />
      </div>
    </div>

    <!-- 业务 Dialogs (保持原有逻辑) -->
    <ResponsiveOverlay v-model="showEditDialog" :title="$t('vault.edit_account')" width="400px">



      <el-form :model="editVaultData" label-position="top">
        <el-form-item :label="$t('vault.service_name')">
          <el-input v-model="editVaultData.service" />
        </el-form-item>
        <el-form-item :label="$t('vault.account_identifier')">
          <el-input v-model="editVaultData.account" />
        </el-form-item>
        <el-form-item :label="$t('vault.category_optional')">
          <el-autocomplete
            v-model="editVaultData.category"
            :fetch-suggestions="(q, cb) => cb(categoryOptions.filter(c => c.toLowerCase().includes(q.toLowerCase())).map(c => ({ value: c })))"
            :placeholder="$t('vault.category_optional')"
            style="width: 100%"
            clearable
            :teleported="false"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showEditDialog = false">{{ $t('common.cancel') }}</el-button>
          <el-button type="primary" :loading="isEditing" @click="submitEditVault">{{ $t('common.save') }}</el-button>
        </span>
      </template>
    </ResponsiveOverlay>

    <ResponsiveOverlay v-model="showQrDialog" :title="$t('vault.export_account')" width="350px" @closed="showSecret = false">



      <div class="qr-container" v-if="currentQrItem">
        <div class="qr-info">
          <h3 class="qr-service">{{ currentQrItem.service }}</h3>
          <p class="qr-account">{{ currentQrItem.account }}</p>
        </div>
        <div class="qr-image-wrapper">
          <img :src="qrCodeUrl" class="qr-code-img" />
        </div>
        <p class="qr-tip">{{ $t('vault.export_qr_tip') }}</p>
        <div class="secret-section">
          <div class="secret-box">
            <div class="secret-text">{{ showSecret ? formatSecret(currentQrItem.secret) : '•••• •••• •••• ••••' }}</div>
            <div class="secret-actions">
              <el-icon class="action-icon" @click="showSecret = !showSecret"><View v-if="!showSecret" /><Hide v-else /></el-icon>
              <el-icon class="action-icon" @click="copySecret"><CopyDocument /></el-icon>
            </div>
          </div>
        </div>
        <div class="uri-link-wrapper">
          <el-button link type="info" size="small" @click="copyOtpUrl">{{ $t('vault.copy_otp_url') }}</el-button>
        </div>
      </div>
    </ResponsiveOverlay>


  </div>
</template>

<script setup>
/**
 * 核心金库列表组件 (Vault List Root Component)
 * 
 * 架构说明 (Architecture Notes):
 * 1. 离线优先与秒开 (Offline-First Initialization): 
 *    `isInitializing` 状态拦截了组件初筛。生命周期 `onMounted` 时优先呼叫 `handleUnlocked` 读取
 *    `localStorage` 加密缓存 (`vaultStore.getData()`)。读取闭环后关闭 `isInitializing` 使得 
 *    UI 瞬间呈现历史数据，随后交由 Vue Query 在后台默默触发真实网络同步 (`fetchVault`) 更新状态，
 *    达到丝滑“秒开”极致体验。
 * 2. 消除瀑布流计算 (Heavy Compute Deferment): 
 *    将获取到缓存后极其冗长的 Hash 计算任务 `updateVaultStatus()` 通过 `setTimeout(..., 0)`
 *    推至浏览器的后续事件队列中，彻底让出 JavaScript 渲染主线程，保障金库大列表在手机端冷启动不白屏、不阻塞。
 * 3. 循环依赖解构 (Dependency Inversion): 
 *    鉴于获取数据的 `useVaultList` 和执行计算的 `useTotpTimer` 各自闭环又存在先后依赖，此处以
 *    `afterLoadRef` 作媒介进行延迟绑定：
 *    `useVaultList` (接收 `afterLoadRef`) -> `useTotpTimer` 实例生成 -> 绑定回调 ->
 *    下一次 Vue Query 拉回新数据时，直接调用绑定的 `updateVaultStatus` 进行后台预运算。
 */
import { ref, onMounted, computed, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { MoreFilled, Edit, Delete, Picture, View, Hide, CopyDocument, Loading, Search, Grid, Expand, Upload } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'

// Components
import VaultIcon from '@/features/vault/components/vaultIcon.vue'
import VaultItemCard from '@/features/vault/components/vaultItemCard.vue'
import ResponsiveOverlay from '@/shared/components/responsiveOverlay.vue'

// Stores & Composables
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { useVaultStore } from '@/features/vault/store/vaultStore'
import { useVaultList } from '@/features/vault/composables/useVaultList'
import { useVaultActions } from '@/features/vault/composables/useVaultActions'
import { vaultService } from '@/features/vault/service/vaultService'
import { useVaultSyncStore } from '@/features/vault/store/vaultSyncStore'

const syncStore = useVaultSyncStore()

const emit = defineEmits(['switch-tab'])
const { t } = useI18n()
const layoutStore = useLayoutStore()
const vaultStore = useVaultStore()

// --- 基础数据逻辑 ---
const afterLoadRef = ref(null)
const {
  serverVault, vault, searchQuery, selectedCategory, isLoading, isFetching, isFetchingNextPage,
  hasNextPage, totalItems, absoluteTotalItems, categoryStats, localCategoryStats, fetchVault, handleLoadMore, refetch, isLoadMoreDisabled
} = useVaultList(afterLoadRef)

// 同步全局搜索
watch(() => layoutStore.searchQuery, (newVal) => {
  if (layoutStore.isMobile) {
    searchQuery.value = newVal
  }
})

// 彻底去除原来 O(N) 全局刷新的 updateVaultStatus 绑定
// 同步搜索加载状态到全局商店 (仅在有搜索关键词时同步，避免分类切换引起抖动)
watch([isFetching, searchQuery], ([newFetching, newQuery]) => {
  layoutStore.isLoadingSearching = newFetching && !!newQuery
})

const {
  selectedIds, isBulkDeleting, toggleSelection, selectAllLoaded, handleBulkDelete,
  showEditDialog, editVaultData, isEditing, handleCommand, submitEditVault,
  showQrDialog, currentQrItem, qrCodeUrl, showSecret, formatSecret, formatCode, getCodeGroups, copyCode, copySecret, copyOtpUrl,
  categoryOptions, performReorder, handleResolveConflict
} = useVaultActions(fetchVault, vault, categoryStats, serverVault)

// 视图模式选项 (View Mode Options)
const viewModeOptions = [
  { value: 'card', icon: Grid },
  { value: 'compact', icon: Expand }
]

// --- 精准响应式布局 ---
const isToolbarFixed = ref(false)

const colProps = {
  xs: 24,
  sm: 12,
  md: 8,
  lg: 6
}

// --- 虚拟列表与响应式网格 (Virtual Scroller 战役二核心) ---
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)

const updateWidth = () => { windowWidth.value = window.innerWidth }
onMounted(() => window.addEventListener('resize', updateWidth))
onUnmounted(() => window.removeEventListener('resize', updateWidth))

const columns = computed(() => {
  if (layoutStore.isMobile) return 1
  if (windowWidth.value >= 1200) return 4
  if (windowWidth.value >= 992) return 3
  if (windowWidth.value >= 768) return 2
  return 1
})

const gridRows = computed(() => {
  const rows = []
  const data = vault.value
  const cols = columns.value
  for (let i = 0; i < data.length; i += cols) {
    rows.push({
      id: `row_${i}`,
      items: data.slice(i, i + cols)
    })
  }
  return rows
})

// --- 物理感拖拽引擎 ---
const draggedId = ref(null)
const draggedItem = computed(() => vault.value.find(i => i.id === draggedId.value))

const floatingPos = ref({ x: 0, y: 0 })
const floatingSize = ref({ w: 0 })
const isPressing = ref(null) // 用于长按视觉反馈
let dragOffset = { x: 0, y: 0 }
let isDragging = false
let scrollRafId = null
let currentScrollSpeed = 0
let scrollAcceleration = 1
let lastMousePos = { x: 0, y: 0 }

const floatingStyle = computed(() => ({
    left: `${floatingPos.value.x}px`,
    top: `${floatingPos.value.y}px`,
    width: `${floatingSize.value.w}px`
}))

// 记录初始索引，用于失败回滚
let originalVault = []

// 抽离精准查找目标位置的逻辑，以便滚动时也能调用
const checkReorder = (x, y) => {
    // 战役三：纯数学坐标推演引擎，完全丢弃 elementFromPoint 的浏览器重排 API 开销
    const scroller = document.querySelector('.vault-scroller')
    if (!scroller) return

    const rect = scroller.getBoundingClientRect()
    
    // 如果在容器内活动
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const localY = y - rect.top
        const localX = x - rect.left
        
        // 【核心修复】：由于切换为 DynamicScroller 原生还原了 Flex 外边距高度，实际每行的高可能不再是强硬的 135px 
        // 所以我们实时侦测一排正在渲染的真实物理高度！防止滚过几十屏后出现 700px 的“数学推演漂移”（放不到下面去）
        const firstRowEl = document.querySelector('.vue-recycle-scroller__item-view')
        const itemHeight = firstRowEl ? firstRowEl.offsetHeight : (layoutStore.appVaultViewMode === 'compact' ? 95 : 135)
        
        const rowIdx = Math.floor(localY / itemHeight)
        const colIdx = Math.floor(localX / (rect.width / columns.value))
        
        // 推演一维数组的目标 Index
        let targetIdx = rowIdx * columns.value + colIdx
        const maxIdx = vault.value.length - 1
        
        if (targetIdx > maxIdx) targetIdx = maxIdx
        if (targetIdx < 0) targetIdx = 0
        
        const targetId = vault.value[targetIdx]?.id
        if (targetId && targetId !== draggedId.value) {
            const list = [...vault.value]
            const fromIdx = list.findIndex(i => i.id === draggedId.value)
            
            if (fromIdx !== -1 && fromIdx !== targetIdx) {
                const [item] = list.splice(fromIdx, 1)
                list.splice(targetIdx, 0, item)
                vault.value = list
            }
        }
    }
}

const onDragStart = (x, y, id, targetEl) => {
    draggedId.value = id
    isDragging = true
    lastMousePos = { x, y }
    originalVault = [...vault.value]
    
    const rect = targetEl.getBoundingClientRect()
    dragOffset = {
        x: x - rect.left,
        y: y - rect.top
    }
    floatingSize.value.w = rect.width
    floatingPos.value = { x: rect.left, y: rect.top }
    
    // 只有在真正开始拖拽时才触发振动，减少 Intervention 警告
    if (layoutStore.isMobile && ('vibrate' in navigator)) {
        try { navigator.vibrate([20]) } catch(e) {}
    }
    
    // 仅移动端锁死 overflow，防止下拉刷新等冲突
    if (layoutStore.isMobile) {
        document.body.style.overflow = 'hidden'
        document.documentElement.style.overflow = 'hidden'
        document.body.style.touchAction = 'none'
    }

    // 强力清除并禁止文本选择
    window.getSelection()?.removeAllRanges()
    document.body.style.userSelect = 'none'
    document.body.style.webkitUserSelect = 'none'
}

const onDragMove = (x, y) => {
    if (!isDragging) return
    lastMousePos = { x, y }
    
    floatingPos.value = {
        x: x - dragOffset.x,
        y: y - dragOffset.y
    }
    
    // 动态边缘滚动（基础速度计算）
    const threshold = 80 // 缩小阈值，让操作更精准
    if (y < threshold) {
        // 向上滚动：距离顶部越近，速度越快
        const baseSpeed = Math.max(-25, Math.floor((y - threshold) / 2.5))
        startAutoScroll(baseSpeed)
    } else if (y > window.innerHeight - threshold) {
        // 向下滚动：距离底部越近，速度越快
        const baseSpeed = Math.min(25, Math.floor((y - (window.innerHeight - threshold)) / 2.5))
        startAutoScroll(baseSpeed)
    } else {
        stopAutoScroll()
    }
    
    checkReorder(x, y)
}

const onDragEnd = () => {
    if (!isDragging) return
    stopAutoScroll()
    performReorder([...vault.value], originalVault)
    isDragging = false
    draggedId.value = null
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
    document.body.style.touchAction = ''
    document.body.style.userSelect = ''
    document.body.style.webkitUserSelect = ''
}

const handleMouseDown = (e, id) => {
    // 排除特定交互区域
    if (e.target.closest('.el-checkbox, .el-dropdown, .el-button, .more-icon')) return
    
    // 基础防误触：区分“点击”与“拖拽”
    const startX = e.clientX
    const startY = e.clientY
    const targetEl = e.currentTarget
    let moved = false
    
    const onMove = (moveEv) => {
        if (!moved) {
            const dist = Math.sqrt(Math.pow(moveEv.clientX - startX, 2) + Math.pow(moveEv.clientY - startY, 2))
            if (dist > 5) {
                moved = true
                onDragStart(startX, startY, id, targetEl)
            }
        }
        if (moved) onDragMove(moveEv.clientX, moveEv.clientY)
    }
    
    const onEnd = () => {
        if (moved) onDragEnd()
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onEnd)
    }
    
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onEnd)
}

const handleTouchStart = (e, id) => {
    // 彻底排除交互区域，确保点击验证码/按钮 100% 优先
    if (e.target.closest('.el-checkbox, .el-dropdown, .el-button, .more-icon, .code-display-area')) return
    
    const touch = e.touches[0]
    const startX = touch.clientX
    const startY = touch.clientY
    const targetEl = e.currentTarget
    
    // 立即显示按压态反馈
    isPressing.value = id
    let dragActivated = false
    
    const timer = setTimeout(() => {
        dragActivated = true
        isPressing.value = null
        onDragStart(startX, startY, id, targetEl)
    }, 250) // 给定 250ms 防止误触

    const onTMove = (moveEv) => {
        if (!dragActivated) {
            // 在按压的 250ms 内，如果手指大范围滑动 (容差 10px)，则认为是列表滚动，取消拖拽意图
            const t = moveEv.touches[0]
            if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
                clearTimeout(timer)
                isPressing.value = null
            }
        } else {
            // 【核心破局点】：一旦拖拽被激活，由于该事件监听器是在触摸**第一帧**就**同步**绑定并标记了 passive: false 的，
            // ios Safari 才会承认 moveEv.preventDefault() 有效，从而完美的掐断底层网页滚动！
            if (moveEv.cancelable) moveEv.preventDefault()
            const mT = moveEv.touches[0]
            onDragMove(mT.clientX, mT.clientY)
        }
    }

    const onTEnd = () => {
        clearTimeout(timer)
        isPressing.value = null
        if (dragActivated) {
            onDragEnd()
        }
        window.removeEventListener('touchmove', onTMove)
        window.removeEventListener('touchend', onTEnd)
        window.removeEventListener('touchcancel', onTEnd)
    }

    // 必须在 touchstart 同步阶段立即挂载 passive: false 的原生处理器
    window.addEventListener('touchmove', onTMove, { passive: false })
    window.addEventListener('touchend', onTEnd)
    window.addEventListener('touchcancel', onTEnd)
}

const startAutoScroll = (speed) => {
    currentScrollSpeed = speed
    if (scrollRafId) return
    
    scrollAcceleration = 1
    const step = () => {
        if (!isDragging) {
            return stopAutoScroll()
        }
        
        const actualMove = currentScrollSpeed * scrollAcceleration
        
        // 核心修复：优先使用 #app 作为滚动容器，以适配全局隐藏滚动条的布局
        let scrollContainer = document.getElementById('app') || document.documentElement
        
        // 兼容旧版布局或特定 PC 端布局
        if (!layoutStore.isMobile && scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
            const mainContent = document.querySelector('.main-content')
            if (mainContent) scrollContainer = mainContent
        }
        
        const oldTop = scrollContainer.scrollTop
        scrollContainer.scrollTop += actualMove
        const newTop = scrollContainer.scrollTop
        
        // 如果容器没变且实际有位移，尝试兜底到 documentElement
        if (Math.abs(newTop - oldTop) < 0.1 && actualMove !== 0 && scrollContainer !== document.documentElement) {
            document.documentElement.scrollTop += actualMove
        }
        
        if (scrollAcceleration < 4) {
            scrollAcceleration += 0.03
        }
        
        checkReorder(lastMousePos.x, lastMousePos.y)
        scrollRafId = requestAnimationFrame(step)
    }
    scrollRafId = requestAnimationFrame(step)
}

const stopAutoScroll = () => {
    if (scrollRafId) {
        cancelAnimationFrame(scrollRafId)
        scrollRafId = null
        scrollAcceleration = 1
        currentScrollSpeed = 0
    }
}


const handleUnlocked = async () => {
    try {
        if (vaultStore.isDirty) {
            fetchVault()
            return
        }
        // 我们不再试图在组件层手动修改 vault.value (因为它是 computed 只读的)
        // useVaultList composable 已经内部接管了 getData() 的逻辑。
        // 我们只需确保统计信息秒开
        const vaultData = await vaultStore.getData()
        if (vaultData && vaultData.categoryStats) {
            localCategoryStats.value = vaultData.categoryStats
        }
    } finally {
        isInitializing.value = false
    }
}

const isInitializing = ref(true)
defineExpose({ fetchVault })
onMounted(handleUnlocked)
</script>

<style scoped>
:deep(.el-radio-button__inner) {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
}
</style>
