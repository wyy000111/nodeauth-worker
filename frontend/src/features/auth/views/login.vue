<template>
  <div class="login-container">
    <el-card class="login-card" shadow="hover">
      <div class="logo-container">
        <img src="/logo.svg?20260402" alt="NodeAuth" class="logo-container-img" />
        <h2>NodeAuth</h2>
        <p class="subtitle">{{ $t('auth.subtitle') }}</p>
      </div>

      <div v-if="isFetchingProviders" class="flex-column flex-center min-h-150">
        <AsyncLoading />
      </div>

      <div v-else class="action-container min-h-100 rounded-8">
        <template v-for="provider in providers" :key="provider.id">
          <el-button
            v-if="provider.id !== 'web3'"
            type="primary"
            size="large"
            class="oauth-btn"
            :style="{ 
              backgroundColor: provider.color, 
              borderColor: provider.color,
              '--el-button-bg-color': provider.color,
              '--el-button-border-color': provider.color,
              '--el-button-hover-bg-color': provider.color,
              '--el-button-active-bg-color': provider.color,
              '--el-button-outline-color': 'transparent'
            }"
            :loading="loadingProvider === provider.id"
            :disabled="!!(loadingProvider || loadingPasskey)"
            @click="handleLogin(provider.id)"
          >
            <template #icon>
              <el-icon v-if="loadingProvider === provider.id" class="is-loading"><Loading /></el-icon>
              <el-icon v-else>
                <component :is="iconComponents[provider.icon] || Platform" />
              </el-icon>
            </template>
            {{ $t('auth.login_with', { provider: provider.name }) }}
          </el-button>
        </template>

        <div class="login-divider" v-if="providers.length > 0">
          OR
        </div>

        <!-- Passkey Login -->
        <el-button
          type="primary"
          size="large"
          class="oauth-btn passkey-btn"
          :loading="loadingPasskey"
          :disabled="!!(loadingProvider || loadingPasskey || loadingWeb3)"
          @click="handlePasskeyLogin"
        >
          <template #icon>
            <el-icon v-if="loadingPasskey" class="is-loading" color="#fff"><Loading /></el-icon>
            <el-icon v-else><iconFingerprint /></el-icon>
          </template>
          {{ $t('auth.passkey_login') }}
        </el-button>

        <Web3WalletLogin 
          :project-id="web3ProjectId" 
          :relay-url="web3RelayUrl"
          :verify-url="web3VerifyUrl"
          :disabled="!!(loadingProvider || loadingPasskey)"
          @loading-start="loadingWeb3 = true" 
          @loading-end="loadingWeb3 = false"
        />
      </div>

      <div class="footer-tips">
        <el-alert
          :title="$t('auth.privacy_title')"
          type="info"
          :description="$t('auth.privacy_desc')"
          show-icon
          :closable="false"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Platform, Loading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import iconGithub from '@/shared/components/icons/iconGithub.vue'
import iconGoogle from '@/shared/components/icons/iconGoogle.vue'
import iconGitee from '@/shared/components/icons/iconGitee.vue'
import iconTelegram from '@/shared/components/icons/iconTelegram.vue'
import iconCloudflare from '@/shared/components/icons/iconCloudflare.vue'
import iconNodeloc from '@/shared/components/icons/iconNodeloc.vue'
import iconFingerprint from '@/shared/components/icons/iconFingerprint.vue'
import Web3WalletLogin from '@/features/auth/components/web3WalletLogin.vue'
import { useOAuthProviders } from '@/features/auth/composables/useOAuthProviders'
import { webAuthnService } from '@/features/auth/service/webAuthnService'
import { useAuthUserStore } from '@/features/auth/store/authUserStore'
import { setIdbItem } from '@/shared/utils/idb'
import { AsyncLoading } from '@/shared/utils/asyncHelper'

const { t } = useI18n()
const router = useRouter()
const authUserStore = useAuthUserStore()

const iconComponents = {
  iconGithub,
  iconGoogle,
  iconGitee,
  iconTelegram,
  iconCloudflare,
  iconNodeloc,
}

const {
  providers,
  loadingProvider,
  isFetchingProviders,
  web3ProjectId,
  web3RelayUrl,
  web3VerifyUrl,
  handleLogin
} = useOAuthProviders()

const loadingPasskey = ref(false)

const handlePasskeyLogin = async () => {
  if (!webAuthnService.isSupported()) {
    ElMessage.warning(t('auth.passkey_not_supported'))
    return
  }

  loadingPasskey.value = true
  try {
    const res = await webAuthnService.login()
    if (res.success) {
      // Passkey 登录逻辑与 OAuth 回调成功后一致
      await authUserStore.setUserInfo(res.userInfo, !!res.needsEmergency, res.encryptionKey || '')
      // 设备指纹 key (用于离线加密验证)
      if (res.deviceKey) {
        await setIdbItem('sys:sec:device_salt', res.deviceKey)
      }
      
      ElMessage.success(t('common.success'))
      if (res.needsEmergency) {
        router.push('/emergency')
      } else {
        window.location.href = '/'
      }
    } else {
      loadingPasskey.value = false
    }
  } catch (error) {
    console.error('Passkey login failed:', error)
    loadingPasskey.value = false
  }
}

// === Web3 Wallet Login Logic ===
const loadingWeb3 = ref(false)
</script>