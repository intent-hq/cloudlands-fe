<script lang="ts">
  let { value = $bindable('') }: { value?: string } = $props();
  export function focus() {
    return undefined;
  }
</script>

<textarea aria-label="setup editor" bind:value></textarea>
