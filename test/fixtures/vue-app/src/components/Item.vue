<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <span class="item">{{ label }}</span>
</template>
