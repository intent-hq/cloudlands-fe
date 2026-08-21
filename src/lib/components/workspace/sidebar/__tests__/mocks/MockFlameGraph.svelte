<script lang="ts">
  let { loading, progress, animationKey }: any = $props();
</script>

<!-- Mirror the real FlameGraph's observable contract: the loading prop swaps
     the progress element for a placeholder, so tests can detect a remount. -->
<div
  data-testid="mock-flame-graph"
  data-loading={String(loading)}
  data-animation-key={animationKey}
>
  {#if loading}
    <div data-testid="mock-flame-placeholder"></div>
  {:else}
    <div data-testid="mock-flame-progress" data-progress={String(progress)}></div>
  {/if}
</div>
