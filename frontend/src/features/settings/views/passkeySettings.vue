<template>
  <div class="passkey-wrapper">
    <div class="tab-card-wrapper">
      <div class="page-header-container">
        <div class="page-header-hero">
          <div class="hero-icon-wrapper">
            <el-icon :size="28"><component :is="Fingerprint" /></el-icon>
          </div>
          <h2 v-if="!layoutStore.isMobile">{{ $t('passkey.passkey_title') }}</h2>
        </div>
        <p class="page-desc-text">{{ $t('passkey.passkey_desc') }}</p>
      </div>
      <div class="passkey-container">
        <div class="passkey-header-actions">
          <h3>{{ $t('passkey.management') }}</h3>
          <el-button type="primary" @click="showAddDialog = true">
            <el-icon><Plus /></el-icon> {{ $t('passkey.add_passkey') }}
          </el-button>
        </div>

        <!-- 全局加载状态 -->
        <div v-if="loading && credentials.length === 0" class="flex-column flex-center min-h-200 text-secondary">
          <el-icon class="is-loading mb-20 text-primary" :size="48"><Loading /></el-icon>
          <p class="text-16 ls-1">{{ $t('common.loading_data') }}</p>
        </div>

        <!-- 空状态 -->
        <div v-else-if="credentials.length === 0" class="empty-state mt-40">
          <el-empty :description="$t('passkey.no_passkeys')" />
        </div>

        <!-- 列表区域 (有数据情况) -->
        <div v-else class="credential-list-container mt-20">
          <el-row :gutter="20">
            <el-col 
              v-for="row in credentials" 
              :key="row.id" 
              :xs="24" :sm="12" :md="8" 
              class="mb-20"
            >
              <el-card shadow="hover" class="passkey-item-card">
                <template #header>
                  <div class="passkey-card-header">
                    <div class="passkey-name-section">
                      <template v-if="editingId === row.id">
                        <el-input 
                          v-model="editName"
                          size="small"
                          @keyup.enter="saveEdit(row)"
                          @keyup.esc="cancelEdit"
                          @blur="cancelEdit"
                          ref="editInputRef"
                          class="passkey-edit-input"
                        />
                      </template>
                      <template v-else>
                        <span class="passkey-name" @click="startEdit(row)">
                          {{ row.name || $t('passkey.default_name') }}
                        </span>
                        <el-button 
                          type="primary" 
                          link 
                          :icon="Edit" 
                          @click="startEdit(row)"
                          class="ml-2 btn-edit-trigger"
                        />
                      </template>
                    </div>
                    <div class="passkey-actions">
                      <el-button 
                        v-if="editingId === row.id"
                        type="success" 
                        link 
                        :icon="Check" 
                        @mousedown.prevent
                        @click="saveEdit(row)"
                      />
                      <el-button 
                        v-else
                        type="danger" 
                        link 
                        :icon="Delete" 
                        @click="handleDelete(row)"
                      />
                    </div>
                  </div>
                </template>

                <div class="passkey-item-body">
                  <div class="passkey-info">
                    <div class="passkey-info-item">
                      <span class="label">{{ $t('passkey.created_at') }}</span>
                      <span class="detail">{{ formatDate(row.created_at) }}</span>
                    </div>
                    <div class="passkey-info-item">
                      <span class="label">{{ $t('passkey.last_used') }}</span>
                      <span class="detail">{{ row.last_used_at ? formatDate(row.last_used_at) : '-' }}</span>
                    </div>
                  </div>
                </div>
              </el-card>
            </el-col>
          </el-row>
        </div>

        <!-- 添加 Passkey 弹窗 -->
        <ResponsiveOverlay
          v-model="showAddDialog"
          :title="$t('passkey.add_dialog_title')"
          width="400px"
        >

          <el-form :model="addForm" @submit.prevent="handleAdd">
            <el-form-item :label="$t('passkey.credential_name')">
              <el-input 
                v-model="addForm.name" 
                :placeholder="$t('passkey.default_name')" 
                clearable
              />
              <p class="text-secondary text-12 mt-8">{{ $t('passkey.add_dialog_tip') }}</p>
            </el-form-item>
          </el-form>
          <template #footer>
            <span class="dialog-footer">
              <el-button @click="showAddDialog = false">{{ $t('common.cancel') }}</el-button>
              <el-button type="primary" :loading="adding" @click="handleAdd">
                {{ $t('common.confirm') }}
              </el-button>
            </span>
          </template>
        </ResponsiveOverlay>


      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { Plus, Delete, Cpu, CircleCheck, Loading, Edit, Check, Key } from '@element-plus/icons-vue'
import Fingerprint from '@/shared/components/icons/iconFingerprint.vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { webAuthnService } from '@/features/auth/service/webAuthnService'
import ResponsiveOverlay from '@/shared/components/responsiveOverlay.vue'



const layoutStore = useLayoutStore()

const { t } = useI18n()
const loading = ref(true)
const adding = ref(false)
const showAddDialog = ref(false)
const credentials = ref([])
const addForm = ref({
  name: ''
})

const editingId = ref(null)
const editName = ref('')
const editInputRef = ref(null)

const startEdit = (row) => {
  editingId.value = row.id
  editName.value = row.name || t('passkey.default_name')
  nextTick(() => {
    if (editInputRef.value) {
      if (Array.isArray(editInputRef.value)) {
        editInputRef.value[0]?.focus()
      } else {
        editInputRef.value.focus()
      }
    }
  })
}

const cancelEdit = () => {
  editingId.value = null
  editName.value = ''
}

const saveEdit = async (row) => {
  const newName = editName.value.trim()
  if (!newName) {
    ElMessage.error(t('passkey.name_required'))
    return
  }
  
  if (newName === row.name) {
    cancelEdit()
    return
  }

  try {
    const res = await webAuthnService.updateCredentialName(row.id, newName)
    if (res.success) {
      ElMessage.success(t('common.success'))
      cancelEdit()
      await fetchCredentials()
    }
  } catch (error) {
    console.error('Failed to update credential name:', error)
  }
}

const fetchCredentials = async () => {
  loading.value = true
  try {
    const res = await webAuthnService.listCredentials()
    if (res.success) {
      credentials.value = res.credentials
    }
  } catch (error) {
    console.error('Failed to fetch credentials:', error)
  } finally {
    loading.value = false
  }
}

const handleAdd = async () => {
  if (!webAuthnService.isSupported()) {
    ElMessage.error(t('auth.passkey_not_supported'))
    return
  }

  adding.value = true
  try {
    const name = addForm.value.name.trim() || t('passkey.default_name')
    const res = await webAuthnService.register(name)
    if (res.success) {
      ElMessage.success(t('passkey.register_success'))
      showAddDialog.value = false
      addForm.value.name = ''
      await fetchCredentials()
    }
  } catch (error) {
    console.error('Passkey registration failed:', error)
    // Error notification is handled by requester or service level usually
  } finally {
    adding.value = false
  }
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm(
      t('passkey.delete_confirm'),
      t('common.warning'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      }
    )
    
    const res = await webAuthnService.deleteCredential(row.id)
    if (res.success) {
      ElMessage.success(t('common.success'))
      await fetchCredentials()
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to delete credential:', error)
    }
  }
}

const formatDate = (timestamp) => {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  const Y = date.getFullYear()
  const M = String(date.getMonth() + 1).padStart(2, '0')
  const D = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${Y}-${M}-${D} ${h}:${m}:${s}`
}

onMounted(() => {
  fetchCredentials()
})
</script>
