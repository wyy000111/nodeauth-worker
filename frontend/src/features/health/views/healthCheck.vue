<template>
  <div class="health-check-container">
    <AsyncLoading v-if="loading" />
    <el-card v-if="!loading && !passed" class="health-card">

      <template #header>
        <div class="health-header">
           <h2 class="alert-title text-24 font-600 text-primary ls-1 mt-15 mb-0">
            <el-icon :size="24" color="var(--el-color-danger)"><WarningFilled /></el-icon>
            {{ $t('healthCheck.title') }}
          </h2>
          <el-alert type="warning" :closable="false" center class="subtitle my-15 p-10">{{ $t('healthCheck.subtitle') }}</el-alert>
        </div>
      </template>

      <div class="issues-list">
        <el-alert
          v-for="(issue, index) in issues"
          :key="index"
          :title="$t(`healthCheck.issues.${issue.message}.title`)"
          :type="issue.level === 'critical' ? 'error' : 'warning'"
          show-icon
          :closable="false"
          class="issue-alert"
        >
          <template #default>
            <div class="issue-content">
              <p class="issue-desc">
                {{ $t(`healthCheck.issues.${issue.message}.desc`) }}
                <template v-if="issue.missingFields && issue.missingFields.length > 0">
                  <br/>
                  <span class="missing-fields-text">
                    <strong>{{ $t('healthCheck.missing_fields') }}</strong> {{ issue.missingFields.join(', ') }}
                  </span>
                </template>
              </p>
              
              <!-- 修复建议区域 -->
              <div class="suggestion-box">
                <div class="suggestion-title">{{ $t('healthCheck.how_to_fix') }}</div>
                
                <div v-if="issue.deploy_by_worker || issue.deploy_by_gitaction || issue.deploy_by_docker" class="deploy-method-guide">
                  <p v-if="issue.deploy_by_worker" class="deploy-item">
                    <el-icon><Monitor /></el-icon> {{ $t(`healthCheck.suggestions.${issue.deploy_by_worker}`) }}
                  </p>
                  <p v-if="issue.deploy_by_gitaction" class="deploy-item">
                    <el-icon><Setting /></el-icon> {{ $t(`healthCheck.suggestions.${issue.deploy_by_gitaction}`) }}
                  </p>
                  <p v-if="issue.deploy_by_docker" class="deploy-item">
                    <el-icon><Box /></el-icon> {{ $t(`healthCheck.suggestions.${issue.deploy_by_docker}`) }}
                  </p>
                </div>
                
                <!-- 针对短密码的特殊处理：提供一键生成 -->
                <div v-if="issue.message === 'encryption_key_too_short' || issue.message === 'jwt_secret_too_short'" class="fix-action">
                  <p>{{ $t(`healthCheck.suggestions.${issue.suggestion}`) }}</p>
                  <div class="key-generator">
                    <el-input v-model="generatedKeys[issue.field]" readonly class="mono-font">
                      <template #append>
                        <el-button @click="copyKey(issue.field)">
                          <el-icon><CopyDocument /></el-icon>
                        </el-button>
                      </template>
                    </el-input>
                    <el-button type="success" plain size="small" @click="generateNewKey(issue.field)" class="mt-10">
                       <el-icon><Refresh /></el-icon> {{ $t('healthCheck.generate_new') }}
                    </el-button>
                  </div>
                </div>
                
                <!-- 针对 ALLOW_ALL 的警告 -->
                <div v-else-if="issue.message === 'oauth_allow_all_enabled'" class="fix-action text-danger">
                  <p>{{ $t(`healthCheck.suggestions.${issue.suggestion}`) }}</p>
                </div>

                <!-- 默认建议展示 -->
                <div v-else class="fix-action">
                   <p>{{ $t(`healthCheck.suggestions.${issue.suggestion}`) }}</p>
                   <div v-if="issue.message.includes('incomplete')" class="doc-link mt-10">
                     <el-link type="primary" href="https://github.com/nodeauth/nodeauth-worker#三配置第三方登录" target="_blank">
                       <el-icon><Document /></el-icon> {{ $t('healthCheck.view_docs') }}
                     </el-link>
                   </div>
                </div>
              </div>
            </div>
          </template>
        </el-alert>

        <div v-if="passedChecks.length > 0" class="passed-checks-section">
          <h3><el-icon color="#67C23A"><Select /></el-icon> {{ $t('healthCheck.passed_checks_title') }}</h3>
          <ul>
            <li v-for="check in passedChecks" :key="check">
              <el-icon color="#67C23A"><Select /></el-icon> {{ $t(`healthCheck.passed_checks.${check}`) }}
            </li>
          </ul>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { WarningFilled, CopyDocument, Refresh, Document, Select, Monitor, Setting, Box } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { request } from '@/shared/utils/request'
import { useClipboard } from '@vueuse/core'
import { i18n } from '@/locales'
import { AsyncLoading } from '@/shared/utils/asyncHelper'

const router = useRouter()
const { copy, isSupported } = useClipboard()

const loading = ref(true)
const passed = ref(false)
const issues = ref([])
const passedChecks = ref([])
const generatedKeys = ref({
  ENCRYPTION_KEY: '',
  JWT_SECRET: ''
})

// 生成 64 字节高强度随机 Hex 字符
const generateHexKey = (length = 64) => {
    // 定义字符集：大写字母、数字、特殊字符
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

    const array = new Uint8Array(length);
    window.crypto.getRandomValues(array);
    
    return Array.from(array, byte => {
        return charset[byte % charset.length];
    }).join('');
}

const generateNewKey = (field) => {
  generatedKeys.value[field] = generateHexKey()
}

const copyKey = async (field) => {
  if (!isSupported.value) {
    ElMessage.error(i18n.global.t('healthCheck.copy_unsupported'))
    return
  }
  await copy(generatedKeys.value[field])
  ElMessage.success(i18n.global.t('healthCheck.copy_success'))
}

const checkHealth = async () => {
  try {
    loading.value = true
    // silent: true 用于防止 request 拦截器对于 403 直接弹出全局红条
    // 这里我们主动捕获错误做 UI 渲染
    const res = await request('/api/health/health-check', { silent: true })
    
    // API endpoint returns 200 OK regardless of passed or failed
    passed.value = res.passed === true
    if (passed.value) {
      router.replace('/login')
      return
    }

    issues.value = res.issues || []
    passedChecks.value = res.passedChecks || []
    
    if (!passed.value) {
      // 为需要生成密码的问题预先生成好密码
      issues.value.forEach(issue => {
        if (issue.field === 'ENCRYPTION_KEY' || issue.field === 'JWT_SECRET') {
           generateNewKey(issue.field)
        }
      })
    }
  } catch (err) {
    // 即使拦截器抛出了 403 error 也有可能是包含 data (issues) 的 AppException
    passed.value = false
    if (err.data && Array.isArray(err.data)) {
        issues.value = err.data
        issues.value.forEach(issue => {
            if (issue.field === 'ENCRYPTION_KEY' || issue.field === 'JWT_SECRET') {
            generateNewKey(issue.field)
            }
        })
    } else {
        ElMessage.error(i18n.global.t('healthCheck.connection_failed'))
    }
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  checkHealth()
})
</script>

