<script lang="ts">

  let { children, content }: any = $props();
  void content;
</script>

{#if children}{@render children()}{/if}
