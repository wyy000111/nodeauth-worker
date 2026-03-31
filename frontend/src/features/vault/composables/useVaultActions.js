import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import QRCode from 'qrcode'
import { useVaultStore } from '@/features/vault/store/vaultStore'
import { useVaultSyncStore } from '@/features/vault/store/vaultSyncStore'
import { vaultService } from '@/features/vault/service/vaultService'
import { copyToClipboard } from '@/shared/utils/common'
import { i18n } from '@/locales'
import { useQueryClient } from '@tanstack/vue-query'
import { buildOtpUri } from '@/shared/utils/totp'

/**
 * 管理账号的增删改查与二维码展示等弹窗行为
 * @param {Function} fetchVault - 操作成功后用于刷新列表的回调
 * @param {import('vue').ShallowRef} vault - 当前账号列表（用于全选）
 * @param {import('vue').Ref} categoryStats - 现有分类统计（用于下拉选择）
 * @returns Composable state and actions
 */
/**
 * @param {Function} fetchVault - 操作成功后用于刷新列表的回调
 * @param {import('vue').ShallowRef} vault - 当前展示列表（计算属性）
 * @param {import('vue').Ref} categoryStats - 分类统计
 * @param {import('vue').ShallowRef} serverVault - 服务器原始数据镜像 (Source of Truth)
 */
export function useVaultActions(fetchVault, vault, categoryStats, serverVault = null) {
    const vaultStore = useVaultStore()
    const queryClient = useQueryClient()
    const { t } = i18n.global

    // --- 批量操作 ---
    const selectedIds = ref([])
    const isBulkDeleting = ref(false)

    // --- 编辑弹窗 ---
    const showEditDialog = ref(false)
    const isEditing = ref(false)
    const editVaultData = ref({ id: '', service: '', account: '', category: '' })

    // --- 二维码弹窗 ---
    const showQrDialog = ref(false)
    const currentQrItem = ref(null)
    const showSecret = ref(false)
    const qrCodeUrl = ref('')

    // --- 批量删除 ---
    const handleBulkDelete = async () => {
        if (!selectedIds.value.length) return
        try {
            await ElMessageBox.confirm(
                t('vault.delete_batch_confirm', { count: selectedIds.value.length }),
                t('common.delete'),
                { type: 'warning', confirmButtonText: t('common.delete'), cancelButtonText: t('common.cancel') }
            )
            isBulkDeleting.value = true
            await vaultService.batchDelete(selectedIds.value)
            ElMessage.success(t('vault.delete_batch_success', { count: selectedIds.value.length }))
            selectedIds.value = []
            vaultStore.markDirty()
            fetchVault()
        } catch (e) {
            if (e !== 'cancel') console.error(e)
        } finally {
            isBulkDeleting.value = false
        }
    }

    const toggleSelection = (id) => {
        const idx = selectedIds.value.indexOf(id)
        if (idx > -1) {
            selectedIds.value.splice(idx, 1)
        } else {
            selectedIds.value.push(id)
        }
    }

    // Bug Fix: 全选已加载账号
    const selectAllLoaded = () => {
        if (vault?.value) {
            selectedIds.value = vault.value.map(acc => acc.id)
        }
    }

    // --- 复制 TOTP 代码 ---
    const copyCode = async (vaultItem, providedCode) => {
        const code = providedCode || vaultItem?.currentCode
        if (!code || code === '------') {
            return ElMessage.warning(t('vault.not_generated_yet'))
        }
        await copyToClipboard(code, t('common.copy_success'))
    }

    // --- 编辑账号 ---
    const openEditDialog = (vaultItem) => {
        editVaultData.value = {
            id: vaultItem.id,
            service: vaultItem.service,
            account: vaultItem.account,
            category: vaultItem.category || '',
            updatedAt: vaultItem.updatedAt
        }
        showEditDialog.value = true
    }

    const submitEditVault = async () => {
        isEditing.value = true
        try {
            const { id, ...updateData } = editVaultData.value
            const res = await vaultService.updateAccount(id, updateData)
            if (res.success) {
                ElMessage.success(t('vault.update_success'))
                showEditDialog.value = false
                vaultStore.markDirty()
                fetchVault()
            }
        } catch (e) {
        } finally {
            isEditing.value = false
        }
    }

    // --- 分数索引重排序 (Fractional Indexing Reorder) ---
    //
    // 旧逻辑：每次拖拽将全量 ID 数组发送到后端 → 8474 次 DB UPDATE (30s 超时)
    // 新逻辑：
    //   1. 比对新旧列表，找出被移动的那一张卡片
    //   2. 取它的新邻居的 sortOrder 值，计算中间值 (midpoint)
    //   3. 只发送 1 次 PATCH 请求，1 次 DB UPDATE
    //   4. 若邻居没有 sortOrder 空间（整数耗尽），回退到全量 reorder()（同时重建间距 1000 的新序列）
    const performReorder = async (newFilteredItems, oldFilteredItems) => {
        // 判定是否有真实变动
        const isChanged = newFilteredItems.some((item, index) => item.id !== oldFilteredItems[index]?.id)
        if (!isChanged) return

        // 1. 立即反馈
        const successMsg = ElMessage.success({
            message: t('vault.sort_updated'),
            duration: 1500,
            customClass: 'message-success-blur'
        })

        // 2. 确定全局新顺序（stitchedFullList 含全部分页，已由 useVaultList 的 setter 实时更新）
        const stitchedFullList = serverVault?.value || newFilteredItems
        const serverOnlyList = stitchedFullList.filter(item => !item.id.startsWith('tmp_'))

        // 3. 找出被移动的那张卡片（对比新旧位置，取第一个位置发生变化的卡片）
        const movedItem = newFilteredItems.find((item, idx) => item.id !== oldFilteredItems[idx]?.id)

        // 4. 尝试分数索引：计算被移动卡片在全局列表中的新位置及其邻居
        if (movedItem) {
            const newGlobalIdx = serverOnlyList.findIndex(i => i.id === movedItem.id)
            const prevItem = newGlobalIdx > 0 ? serverOnlyList[newGlobalIdx - 1] : null
            const nextItem = newGlobalIdx < serverOnlyList.length - 1 ? serverOnlyList[newGlobalIdx + 1] : null

            const prevSortOrder = prevItem?.sortOrder ?? null
            const nextSortOrder = nextItem?.sortOrder ?? null

            // sortOrder 降序（值越大越靠前），因此 prevSortOrder > 被插入值 > nextSortOrder
            let newSortOrder = null
            if (prevSortOrder === null && nextSortOrder === null) {
                // 列表只有 1 项
                newSortOrder = 1000
            } else if (prevSortOrder === null) {
                // 移到最顶部：比最大值再大 1000
                newSortOrder = (nextSortOrder ?? 0) + 1000
            } else if (nextSortOrder === null) {
                // 移到最底部：比最小值再小 1000，不低于 0
                newSortOrder = Math.max(0, (prevSortOrder ?? 0) - 1000)
            } else {
                // 插入两项之间：取中间整数
                const mid = Math.floor((prevSortOrder + nextSortOrder) / 2)
                if (mid > nextSortOrder && mid < prevSortOrder) {
                    newSortOrder = mid
                }
                // mid === nextSortOrder 或 mid === prevSortOrder 说明已无整数空间 → 回退全量
            }

            if (newSortOrder !== null) {
                // 乐观更新前端 sortOrder，防止 refetch 前的视觉回跳
                movedItem.sortOrder = newSortOrder
                queryClient.setQueriesData({ queryKey: ['vault'] }, (oldData) => {
                    if (!oldData) return oldData
                    let currentIndex = 0
                    const newPages = oldData.pages.map(page => {
                        const pageLen = page.vault?.length || 0
                        const nextIndex = currentIndex + pageLen
                        const updatedVault = serverOnlyList.slice(currentIndex, nextIndex)
                        currentIndex = nextIndex
                        return { ...page, vault: updatedVault }
                    })
                    return { ...oldData, pages: newPages }
                })

                try {
                    await vaultService.moveSortOrder(movedItem.id, newSortOrder)
                    vaultStore.markDirty()
                } catch (e) {
                    successMsg?.close()
                    vault.value = oldFilteredItems
                    fetchVault()
                }
                return
            }
        }

        // 5. 回退：无法分数插入（整数空间耗尽）→ 全量重排，同时后端用间距 1000 重建序列
        const serverOnlyIds = serverOnlyList.map(i => i.id)
        queryClient.setQueriesData({ queryKey: ['vault'] }, (oldData) => {
            if (!oldData) return oldData
            let currentIndex = 0
            const newPages = oldData.pages.map(page => {
                const pageLen = page.vault?.length || 0
                const nextIndex = currentIndex + pageLen
                const updatedVault = serverOnlyList.slice(currentIndex, nextIndex)
                currentIndex = nextIndex
                return { ...page, vault: updatedVault }
            })
            return { ...oldData, pages: newPages }
        })

        try {
            await vaultService.reorder(serverOnlyIds)
            vaultStore.markDirty()
        } catch (e) {
            successMsg?.close()
            vault.value = oldFilteredItems
            fetchVault()
        }
    }

    // --- 删除单个账号 ---
    const deleteVault = async (vaultItem) => {
        try {
            await ElMessageBox.confirm(t('vault.delete_confirm', { service: vaultItem.service }), t('common.delete'), {
                type: 'warning',
                confirmButtonText: t('common.delete'),
                cancelButtonText: t('common.cancel')
            })
            await vaultService.deleteAccount(vaultItem.id, { updatedAt: vaultItem.updatedAt })
            ElMessage.success(t('vault.delete_success'))
            vaultStore.markDirty()
            fetchVault()
        } catch (e) {
            if (e !== 'cancel') console.error(e)
        }
    }

    // --- 二维码导出 ---
    const openQrDialog = async (vaultItem) => {
        currentQrItem.value = vaultItem
        showSecret.value = false
        showQrDialog.value = true

        const uri = buildOtpUri({
            service: vaultItem.service,
            account: vaultItem.account,
            secret: vaultItem.secret,
            algorithm: vaultItem.algorithm,
            digits: vaultItem.digits,
            period: vaultItem.period
        })
        qrCodeUrl.value = await QRCode.toDataURL(uri, { width: 240, margin: 1 })
    }

    const copySecret = () => {
        if (currentQrItem.value) {
            copyToClipboard(currentQrItem.value.secret)
            ElMessage.success(t('common.copy_success'))
        }
    }

    const copyOtpUrl = () => {
        if (currentQrItem.value) {
            const item = currentQrItem.value
            const uri = buildOtpUri({
                service: item.service,
                account: item.account,
                secret: item.secret,
                algorithm: item.algorithm,
                digits: item.digits,
                period: item.period
            })
            copyToClipboard(uri)
            ElMessage.success(t('common.copy_success'))
        }
    }

    const formatSecret = (secret) => {
        return (secret || '').match(/.{1,4}/g)?.join(' ') || secret
    }

    const formatCode = (code, digits) => {
        if (!code || code === '------' || typeof code !== 'string') return code
        const cleanCode = code.replace(/\s/g, '')
        if (digits === 6 && cleanCode.length === 6) {
            // 使用 \u2009 (Thin Space) 替代普通空格，使间距更恰到好处
            return `${cleanCode.slice(0, 3)}\u2009${cleanCode.slice(3)}`
        }
        if (digits === 8 && cleanCode.length === 8) {
            return `${cleanCode.slice(0, 4)}\u2009${cleanCode.slice(4)}`
        }
        return cleanCode
    }

    const getCodeGroups = (code, digits) => {
        if (!code || code === '------' || typeof code !== 'string') return [code, '']
        const cleanCode = code.replace(/\s/g, '')
        if (digits === 6 && cleanCode.length === 6) {
            return [cleanCode.slice(0, 3), cleanCode.slice(3)]
        }
        if (digits === 8 && cleanCode.length === 8) {
            return [cleanCode.slice(0, 4), cleanCode.slice(4)]
        }
        // Steam 5位代码或非标位数不进行逻辑分组
        return [cleanCode, '']
    }

    // --- 统一命令分发 ---
    const handleCommand = (cmd, vaultItem) => {
        if (cmd === 'edit') openEditDialog(vaultItem)
        else if (cmd === 'qr') openQrDialog(vaultItem)
        else if (cmd === 'delete') deleteVault(vaultItem)
    }
    // --- 解决同步冲突 ---
    const handleResolveConflict = async (id, strategy) => {
        const syncStore = useVaultSyncStore()
        await syncStore.resolveConflict(id, strategy)

        if (strategy === 'force') {
            ElMessage.success(t('vault.conflict_force_applied'))
            // 触发自动同步
            vaultService.syncOfflineActions().then(() => fetchVault())
        } else {
            ElMessage.info(t('vault.conflict_discarded'))
            fetchVault()
        }
    }

    return {
        selectedIds,
        isBulkDeleting,
        showEditDialog,
        isEditing,
        editVaultData,
        showQrDialog,
        currentQrItem,
        showSecret,
        qrCodeUrl,
        categoryOptions: computed(() => {
            return (categoryStats?.value || [])
                .filter(s => s.category) // 排除“未分类”空字符串项，由 Select 的 allow-create 或手动清空处理
                .map(s => s.category)
        }),

        toggleSelection,
        selectAllLoaded,
        handleBulkDelete,
        copyCode,
        openEditDialog,
        submitEditVault,
        deleteVault,
        openQrDialog,
        copySecret,
        copyOtpUrl,
        formatSecret,
        formatCode,
        getCodeGroups,
        handleCommand,
        performReorder,
        handleResolveConflict
    }
}
