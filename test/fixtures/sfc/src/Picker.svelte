<script module lang="ts">
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
</script>

<script lang="ts">
  let { n, name } = $props();
</script>

{#if n > 0}<p>{classify(n, name)}</p>{/if}
