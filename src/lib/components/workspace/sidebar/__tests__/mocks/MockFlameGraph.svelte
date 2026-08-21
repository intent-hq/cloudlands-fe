<script lang="ts">
  let { loading, animationKey }: any = $props();
</script>

<div
  data-testid="mock-flame-graph"
  data-loading={String(loading)}
  data-animation-key={animationKey}
></div>
