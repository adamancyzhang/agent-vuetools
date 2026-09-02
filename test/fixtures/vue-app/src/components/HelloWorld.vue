<script setup lang="ts">
defineProps<{ greeting: string }>();
</script>

<template>
  <div id="hw">
    <p class="greet">{{ greeting }}</p>
    <slot name="actions"></slot>
  </div>
</template>
