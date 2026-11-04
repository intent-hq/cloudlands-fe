<script lang="ts">
  let { children }: any = $props();
</script>

{#if children}{@render children()}{/if}
