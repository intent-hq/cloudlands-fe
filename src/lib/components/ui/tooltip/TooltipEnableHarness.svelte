<script lang="ts">
  import Button from '../button/button.svelte';
  import Tooltip from './Tooltip.svelte';

  // Help that is enabled only after a measurement, like a clipped-name tooltip.
  let { disabled = true }: { disabled?: boolean } = $props();
</script>

<Tooltip content="Measured full name help" delayDuration={300} {disabled}>
  <Button aria-label="Show measured help" variant="ghost">Measured help</Button>
</Tooltip>
