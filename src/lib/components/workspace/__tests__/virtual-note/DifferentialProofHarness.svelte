<script lang="ts">
  import Harness from './DocumentProofHarness.svelte';
</script>

<div style="display: flex; gap: 20px;">
  <div data-testid="bounded" style="width: 550px;"><Harness small /></div>
  <div data-testid="native" style="width: 550px;"><Harness oracle small /></div>
</div>
