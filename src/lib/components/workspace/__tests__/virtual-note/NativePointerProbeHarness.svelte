<script lang="ts">
  import Harness from './DocumentProofHarness.svelte';
  let { sourceOverride, paired = false }: { sourceOverride: string; paired?: boolean } = $props();
</script>

<div style="display: flex; gap: 20px;">
  <div data-testid="bounded" style="width: 550px;">
    {#if paired}<Harness paragraphRepeats={2048} {sourceOverride} />{/if}
  </div>
  <div data-testid="native" style="width: 550px;">
    <Harness oracle paragraphRepeats={2048} {sourceOverride} />
  </div>
</div>
