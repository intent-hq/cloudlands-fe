<script lang="ts">
  import Harness from './DocumentProofHarness.svelte';
</script>

<div style="display: flex; gap: 20px;">
  <div data-testid="bounded" style="width: 550px;"><Harness paragraphRepeats={2048} /></div>
  <div data-testid="native" style="width: 550px;"><Harness oracle paragraphRepeats={2048} /></div>
</div>
