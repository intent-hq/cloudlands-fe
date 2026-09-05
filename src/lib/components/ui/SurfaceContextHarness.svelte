<script lang="ts">
  import SurfaceContextConsumer from './SurfaceContextConsumer.svelte';
  import SurfaceProvider from './SurfaceProvider.svelte';
</script>

<SurfaceContextConsumer testId="unscoped-surface" />
<SurfaceProvider value={3}>
  <SurfaceContextConsumer testId="provided-surface" />
  <SurfaceProvider value={20}>
    <SurfaceContextConsumer testId="nested-surface" />
  </SurfaceProvider>
</SurfaceProvider>
