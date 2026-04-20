<script lang="ts">
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let { children, title, active, activeColor }: any = $props();
  void active; void activeColor;
</script>

<div data-testid="timeline-section" data-title={title}>
  {#if children}{@render children()}{/if}
</div>
