<script setup lang="ts">
import { computed, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    count?: number;
    step: number;
    label?: string;
  }>(),
  { count: 0, label: 'Count' },
);

const emit = defineEmits<{ change: [value: number] }>();

const doubled = computed(() => props.count * 2);
const local = ref(7);

function increment() {
  emit('change', props.count + props.step);
}
</script>

<template>
  <div id="counter-box">
    <button id="count-btn" @click="increment">{{ label }}: {{ count }}</button>
    <span id="doubled">doubled: {{ doubled }}</span>
    <span>local: {{ local }}</span>
  </div>
</template>
