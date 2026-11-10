<script lang="ts">
  import SurfaceContextConsumerTestHost from './SurfaceContextConsumerTestHost.svelte';
  import SurfaceProvider from './SurfaceProvider.svelte';
</script>

<SurfaceContextConsumerTestHost testId="unscoped-surface" />
<SurfaceProvider value={3}>
  <SurfaceContextConsumerTestHost testId="provided-surface" />
  <SurfaceProvider value={20}>
    <SurfaceContextConsumerTestHost testId="nested-surface" />
  </SurfaceProvider>
</SurfaceProvider>
