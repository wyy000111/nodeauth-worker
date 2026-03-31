<template>
  <div class="layout-blank">
    <TheHeader />
    <main class="layout-blank-content">
      <RouterView />
    </main>
    <TheFooter />
  </div>
</template>

<script setup>
import TheHeader from '@/shared/components/theHeader.vue'
import TheFooter from '@/shared/components/theFooter.vue'
import { RouterView } from 'vue-router'
</script>


