<template>
  <div class="migration-container">
    <el-tabs v-model="app_active_tab" class="migration-tabs">
      <el-tab-pane :label="$t('migration.export')" name="export">
        <DataExport />
      </el-tab-pane>
      <el-tab-pane :label="$t('migration.import')" name="import">
        <DataImport @success="$emit('success')" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import DataExport from '@/features/migration/views/dataExport.vue'
import DataImport from '@/features/migration/views/dataImport.vue'

const emit = defineEmits(['success'])
const app_active_tab = ref('export')
</script>

