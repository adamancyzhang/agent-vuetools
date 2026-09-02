<script setup lang="ts">
import { provide, ref } from 'vue';
import HelloWorld from './components/HelloWorld.vue';
import Counter from './components/Counter.vue';
import TeleportBox from './components/TeleportBox.vue';
import MultiRoot from './components/MultiRoot.vue';
import ItemList from './components/ItemList.vue';

const title = ref('agent-vuetools fixture');
provide('theme', 'dark');
const count = ref(3);
const handleChange = (v: number) => {
  count.value = v;
};
</script>

<template>
  <div id="app-root" class="app-shell">
    <h1>{{ title }}</h1>
    <HelloWorld greeting="Hi from fixture">
      <template #actions>
        <button class="slot-btn">slot action</button>
      </template>
    </HelloWorld>
    <Counter :count="count" :step="1" @change="handleChange" />
    <TeleportBox />
    <MultiRoot />
    <ItemList :items="['alpha', 'beta', 'gamma']" />
  </div>
</template>
