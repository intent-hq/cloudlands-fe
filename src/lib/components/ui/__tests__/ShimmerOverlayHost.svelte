<script lang="ts">
  import ShimmerOverlay from '../ShimmerOverlay.svelte';
</script>

<div>
  <div data-testid="shimmer-text">
    <ShimmerOverlay>Processing</ShimmerOverlay>
  </div>
  <div data-testid="shimmer-overlay" style="position: relative; width: 100px; height: 20px">
    <ShimmerOverlay />
  </div>
</div>
