<template>
  <div class="apps-review-container">
    <!-- 头部说明已由父组件 UtilityTools 统一处理 -->

    <el-row :gutter="20" class="flex flex-wrap">
      <el-col
        v-for="app in appList"
        :key="app.id"
        :xs="24"
        :sm="24"
        :md="12"
        :lg="12"
        :xl="8"
        class="mb-20"
      >
        <el-card shadow="hover" class="apps-review-card" :class="{'security-alert': app.securityIssue}">
          <div class="apps-review-card-header">
            <h3 class="apps-review-card-name">
              <el-icon :size="28" class="apps-review-card-logo">
                <component :is="app.icon" />
              </el-icon>
              {{ app.name }}
              <el-tag v-if="app.recommended" type="success" effect="dark" size="small">🏅 Recommended</el-tag>
              <el-tag v-if="app.securityIssue" type="danger" effect="dark" size="small">⚠️ Warning</el-tag>
            </h3>
            <div class="rating-box">
              <el-rate v-model="app.rating" disabled allow-half show-score text-color="#ff9900" score-template="{value}" />
            </div>
          </div>
          
          <div class="apps-review-card-meta">
            <el-link :href="app.link" target="_blank" type="primary" :underline="false">
              {{ $t('tools.apps_review_table.website') }}
            </el-link>

             <span class="downloads-label text-13 text-regular ml-5" v-if="app.downloads">{{ $t('tools.apps_review_table.platforms') }}:</span>
            
            <div class="flex flex-wrap gap-8 flex-items-center" v-if="app.downloads">
              <el-tooltip v-if="app.downloads.ios" content="App Store" placement="top">
                <el-link :href="app.downloads.ios" target="_blank" :underline="false" class="apps-review-platform-btn">
                  <el-icon><Apple /></el-icon>
                </el-link>
              </el-tooltip>
              <el-tooltip v-if="app.downloads.android" content="Google Play" placement="top">
                <el-link :href="app.downloads.android" target="_blank" :underline="false" class="apps-review-platform-btn">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
					          <path d="M 5.4160156 2.328125 L 13.296875 10.535156 L 15.626953 8.109375 C 11.611953 5.838375 6.3020156 2.834125 5.4160156 2.328125 z M 3.140625 2.8476562 C 3.055625 3.0456562 3 3.2629063 3 3.5039062 L 3 20.591797 C 3 20.788797 3.044375 20.970625 3.109375 21.140625 L 11.910156 11.978516 L 3.140625 2.8476562 z M 17.423828 9.1269531 L 14.683594 11.978516 L 17.402344 14.810547 C 19.071344 13.865547 20.226562 13.210937 20.226562 13.210938 C 20.725562 12.907937 21.005047 12.441594 20.998047 11.933594 C 20.991047 11.438594 20.702609 10.981938 20.224609 10.710938 C 20.159609 10.673937 19.031828 10.035953 17.423828 9.1269531 z M 13.296875 13.423828 L 5.4746094 21.566406 C 6.8216094 20.800406 11.797469 17.982172 15.605469 15.826172 L 13.296875 13.423828 z"/>
                  </svg>
                </el-link>
              </el-tooltip>
              <el-tooltip v-if="app.downloads.github" content="GitHub Releases" placement="top">
                <el-link :href="app.downloads.github" target="_blank" :underline="false" class="apps-review-platform-btn">
                  <svg viewBox="0 0 24 24" width="1em" height="1em" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.45-1.15-1.11-1.46-1.11-1.46-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z"/>
                  </svg>
                </el-link>
              </el-tooltip>
              <el-tooltip v-if="app.downloads.fdroid" content="F-Droid" placement="top">
                <el-link :href="app.downloads.fdroid" target="_blank" :underline="false" class="apps-review-platform-btn">
                  <span style="font-weight: bold; font-family: monospace;">FD</span>
                </el-link>
              </el-tooltip>
              <el-tooltip v-if="app.downloads.extension || app.downloads.desktop" content="Extension / Desktop" placement="top">
                <el-link :href="app.downloads.extension || app.downloads.desktop" target="_blank" :underline="false" class="apps-review-platform-btn">
                  <el-icon><Monitor /></el-icon>
                </el-link>
              </el-tooltip>
            </div>
          </div>

          <el-divider border-style="dashed" class="my-10" />

          <div class="apps-review-details">
            <div class="apps-review-detail-item pros">
              <span class="label text-14 font-500"><el-icon color="#67C23A"><Select /></el-icon> {{ $t('tools.apps_review_table.pros') }}:</span>
              <span class="flex-1">{{ $t(`tools.apps.${app.id}.pros`) }}</span>
            </div>
            <div class="apps-review-detail-item cons">
              <span class="label text-14 font-500"><el-icon color="#909399"><CloseBold /></el-icon> {{ $t('tools.apps_review_table.cons') }}:</span>
              <span class="flex-1">{{ $t(`tools.apps.${app.id}.cons`) }}</span>
            </div>
            <div class="apps-review-detail-item security" v-if="app.securityIssue || $t(`tools.apps.${app.id}.security`) !== '无安全事故记录'">
              <span class="label text-14 font-500" :class="{'text-danger': app.securityIssue}"><el-icon><Warning /></el-icon> {{ $t('tools.apps_review_table.security') }}:</span>
              <span class="flex-1" :class="{'text-danger': app.securityIssue}">{{ $t(`tools.apps.${app.id}.security`) }}</span>
            </div>
            
            <div class="apps-review-summary-box" :class="{'apps-review-summary-danger': app.rating <= 2}">
              <strong>{{ $t('tools.apps_review_table.summary') }}: </strong>
              {{ $t(`tools.apps.${app.id}.summary`) }}
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { Monitor, Link, House, Warning, Select, CloseBold, Apple } from '@element-plus/icons-vue'

import Icon2FAS from '@/shared/components/icons/icon2FAS.vue'
import IconAegis from '@/shared/components/icons/iconAegis.vue'
import IconEnte from '@/shared/components/icons/iconEnte.vue'
import IconProtonAuth from '@/shared/components/icons/iconProtonAuth.vue'
import IconBitwardenAuth from '@/shared/components/icons/iconBitwardenAuth.vue'
import IconMicrosoftAuth from '@/shared/components/icons/iconMicrosoftAuth.vue'
import IconGoogleAuth from '@/shared/components/icons/iconGoogleAuth.vue'
import IconFreeOTP from '@/shared/components/icons/iconFreeOTP.vue'
import IconAuthy from '@/shared/components/icons/iconAuthy.vue'
import iconLastPassAuth from '@/shared/components/icons/iconLastPassAuth.vue'
import IconRaivo from '@/shared/components/icons/iconRaivo.vue'

const appList = [
  { id: '2fas', name: '2FAS Auth', rating: 5, icon: Icon2FAS, link: 'https://2fas.com/', recommended: true, securityIssue: false, downloads: { ios: 'https://apps.apple.com/us/app/2fas-authenticator/id1217793794', android: 'https://play.google.com/store/apps/details?id=com.twofasapp', github: 'https://github.com/twofas/2fas-android', extension: 'https://chrome.google.com/webstore/detail/2fas-authenticator/jnlkjeecnpjoeoojhkehdjhhnhbepfki' } },
  { id: 'ente', name: 'Ente Auth', rating: 4.8, icon: IconEnte, link: 'https://ente.io/auth/', recommended: true, securityIssue: false, downloads: { ios: 'https://apps.apple.com/app/ente-authenticator/id6444101188', android: 'https://play.google.com/store/apps/details?id=io.ente.auth', fdroid: 'https://f-droid.org/packages/io.ente.auth', github: 'https://github.com/ente-io/ente/releases', desktop: 'https://ente.io/download/auth/desktop' } },
  { id: 'aegis', name: 'Aegis Authenticator', rating: 4.8, icon: IconAegis, link: 'https://getaegis.app/', recommended: true, securityIssue: false, downloads: { android: 'https://play.google.com/store/apps/details?id=com.beemdevelopment.aegis', fdroid: 'https://f-droid.org/packages/com.beemdevelopment.aegis/', github: 'https://github.com/beemdevelopment/Aegis/releases' } },
  { id: 'proton', name: 'Proton Authenticator', rating: 4.5, icon: IconProtonAuth, link: 'https://proton.me/pass', recommended: false, securityIssue: false, downloads: { ios: 'https://apps.apple.com/us/app/proton-pass-password-manager/id6443490729', android: 'https://play.google.com/store/apps/details?id=me.proton.android.pass', extension: 'https://chrome.google.com/webstore/detail/proton-pass-free-password/ghmbeldphafepmbegfdlkmapnddhbheg' } },
  { id: 'bitwarden', name: 'Bitwarden Authenticator', rating: 4.2, icon: IconBitwardenAuth, link: 'https://bitwarden.com/products/authenticator/', recommended: false, securityIssue: false, downloads: { ios: 'https://apps.apple.com/us/app/bitwarden-authenticator/id6475654992', android: 'https://play.google.com/store/apps/details?id=com.bitwarden.authenticator', github: 'https://github.com/bitwarden/authenticator/releases' } },
  { id: 'google', name: 'Google Authenticator', rating: 4.0, icon: IconGoogleAuth, link: 'https://safety.google/authentication/', recommended: false, securityIssue: false, downloads: { ios: 'https://apps.apple.com/us/app/google-authenticator/id388497605', android: 'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2' } },
  { id: 'freeotp', name: 'FreeOTP', rating: 3.0, icon: IconFreeOTP, link: 'https://freeotp.github.io/', recommended: false, securityIssue: false, downloads: { ios: 'https://apps.apple.com/us/app/freeotp-authenticator/id872559395', android: 'https://play.google.com/store/apps/details?id=org.fedorahosted.freeotp', fdroid: 'https://f-droid.org/en/packages/org.fedorahosted.freeotp/' } },
  { id: 'microsoft', name: 'Microsoft Authenticator', rating: 2.0, icon: IconMicrosoftAuth, link: 'https://www.microsoft.com/en-us/security/mobile-authenticator-app', recommended: false, securityIssue: true, downloads: { ios: 'https://apps.apple.com/us/app/microsoft-authenticator/id983156458', android: 'https://play.google.com/store/apps/details?id=com.azure.authenticator' } },
  { id: 'authy', name: 'Authy', rating: 1.5, icon: IconAuthy, link: 'https://authy.com/', recommended: false, securityIssue: true, downloads: { ios: 'https://apps.apple.com/us/app/twilio-authy/id494168017', android: 'https://play.google.com/store/apps/details?id=com.authy.authy' } },
  { id: 'lastpass', name: 'LastPass Auth', rating: 1.5, icon: iconLastPassAuth, link: 'https://www.lastpass.com/auth', recommended: false, securityIssue: true, downloads: { ios: 'https://apps.apple.com/us/app/lastpass-authenticator/id1079110004', android: 'https://play.google.com/store/apps/details?id=com.lastpass.authenticator' } },
  { id: 'raivo', name: 'Raivo OTP', rating: 1.0, icon: IconRaivo, link: 'https://raivo-otp.com/', recommended: false, securityIssue: true, downloads: { ios: 'https://apps.apple.com/us/app/raivo-otp/id1459042137' } }
]
</script>

