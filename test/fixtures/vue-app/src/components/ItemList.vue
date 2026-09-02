<script setup lang="ts">
import Item from './Item.vue';

defineProps<{ items: string[] }>();
</script>

<template>
  <ul id="item-list">
    <li v-for="item in items" :key="item">
      <Item :label="item" />
    </li>
  </ul>
</template>
