<template>
  <div class="about-view">
    <div class="page-header-container about-header">
      <div class="page-header-hero">
        <div class="hero-icon-wrapper">
          <img src="/logo.svg?20260402" alt="NodeAuth" width="32px" height="32px" />
        </div>
        <h2 class="about-title">NodeAuth</h2>
      </div>
      <p class="page-desc-text underline-link">{{ $t('about.tagline') }}</p>
    </div>

    <div class="info-list">
      <div class="info-item">
        <span class="label">{{ $t('about.version') }}</span>
        <span class="detail">{{ appVersion }}</span>
      </div>
      <div class="info-item" v-if="commitHash && commitHash !== 'unknown'">
        <span class="label">{{ $t('about.commit') }}</span>
        <span class="detail">{{ commitHash }}</span>
      </div>
      <div class="info-item">
        <span class="label">{{ $t('about.platform') }}</span>
        <span class="detail">{{ appPlatform }}</span>
      </div>
    </div>

    <div class="about-footer">
      <p>&copy;{{ new Date().getFullYear() }} <a href="https://github.com/nodeauth/nodeauth-worker" target="_blank" class="underline-link">{{ $t('about.open_source_github') }}</a> | <a href="https://wiki.nodeauth.io" target="_blank" class="underline-link">{{ $t('about.documentation') }}</a></p>
    </div>
  </div>
</template>

<script setup>
import { Lock } from '@element-plus/icons-vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'

const layoutStore = useLayoutStore()

const commitHash = typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'unknown'
const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
const appPlatform = typeof __APP_PLATFORM__ !== 'undefined' ? __APP_PLATFORM__ : 'Cloudflare Workers'
</script>
