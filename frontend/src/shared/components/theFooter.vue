<template>
  <footer class="global-footer">
    <div class="footer-content">
      <p>
        &copy;{{ new Date().getFullYear() }} 
        <a href="https://github.com/nodeauth/nodeauth-worker" target="_blank" rel="noopener noreferrer">NodeAuth</a>
        <span v-if="!layoutStore.isMobile">
          <span class="divider">|</span>
          A Secure 2FA Management Tool
        </span>
        <span class="version-info" :title="`Commit Hash: ${commitHash}`">
          <span class="divider">|</span>
          v{{ appVersion }}<span v-if="commitHash && commitHash !== 'unknown'" class="commit-hash"> ({{ commitHash }})</span>
        </span>
      </p>
    </div>
  </footer>
</template>

<script setup>
import { useLayoutStore } from '@/features/home/store/layoutStore'

const layoutStore = useLayoutStore()
// 注入在 vite.config.js 中定义的全局构建环境变量
const commitHash = typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'unknown'
const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
</script>

<style scoped>
.version-info {
  display: inline-flex;
  align-items: center;
}
.commit-hash {
  font-family: monospace;
  font-size: 0.95em;
  opacity: 0.85;
  margin-left: 3px;
}
</style>