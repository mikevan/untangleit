<script lang="ts">
import { defineComponent } from 'vue';

export function classify(n: number, name: string): string {
  if (n > 0) {
    if (name && name.trim()) {
      return `positive ${name}`;
    }
    return 'positive';
  } else if (n < 0) {
    return 'negative';
  }
  return 'zero';
}

export default defineComponent({ name: 'Picker' });
</script>

<template>
  <p v-if="n > 0">{{ classify(n, name) }}</p>
</template>
