<template>
  <div class="callback-container">
    <el-card class="loading-card" shadow="hover">
      <el-result
        v-if="!errorMsg"
        icon="info"
        :title="$t('auth.secure_login_in_progress')"
        :sub-title="$t('auth.secure_login_sub', { provider: providerName })"
      >
        <template #extra>
          <el-icon class="is-loading" :size="40"><Loading /></el-icon>
        </template>
      </el-result>

      <el-result
        v-else
        icon="error"
        :title="$t('auth.auth_failed_title')"
        :sub-title="errorMsg"
      >
        <template #extra>
          <el-button type="primary" @click="goBackToLogin">{{ $t('auth.back_to_login') }}</el-button>
        </template>
      </el-result>
    </el-card>
  </div>
</template>

<script setup>
import { Loading } from '@element-plus/icons-vue'
import { useOAuthCallback } from '@/features/auth/composables/useOAuthCallback'

const {
  errorMsg,
  providerName,
  goBackToLogin
} = useOAuthCallback()
</script>