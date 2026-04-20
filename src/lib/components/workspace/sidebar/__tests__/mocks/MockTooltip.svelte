<script lang="ts">
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let { children, content }: any = $props();
  void content;
</script>

{#if children}{@render children()}{/if}
