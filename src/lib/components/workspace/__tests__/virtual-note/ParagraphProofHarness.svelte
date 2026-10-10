<script lang="ts">
  import Harness from './DocumentProofHarness.svelte';
  let { sourceOverride, anchors = false }: { sourceOverride?: string; anchors?: boolean } =
    $props();
</script>

<div style="display: flex; gap: 20px;">
  <div data-testid="bounded" style="width: 550px;">
    <Harness paragraphRepeats={2048} {sourceOverride} {anchors} />
  </div>
  <div data-testid="native" style="width: 550px;">
    <Harness oracle paragraphRepeats={2048} {sourceOverride} {anchors} />
  </div>
</div>
