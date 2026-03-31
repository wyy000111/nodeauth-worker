<template>
  <div class="data-backup-wrapper">
    <div class="tab-card-wrapper">
      <div class="page-header-container">
        <div class="page-header-hero">
          <div class="hero-icon-wrapper">
            <el-icon :size="28"><Cloudy /></el-icon>
          </div>
          <h2 v-if="!layoutStore.isMobile">{{ $t('backup.center_title') }}</h2>
        </div>
        <p class="page-desc-text">{{ $t('backup.center_desc') }}</p>
      </div>
      <BackupSettings @restore-success="$emit('success')" />
    </div>
  </div>
</template>

<script setup>
import { Cloudy } from '@element-plus/icons-vue'
import BackupSettings from '@/features/backup/components/backupSettings.vue'
import { useLayoutStore } from '@/features/home/store/layoutStore'

const layoutStore = useLayoutStore()
const emit = defineEmits(['success'])
</script>