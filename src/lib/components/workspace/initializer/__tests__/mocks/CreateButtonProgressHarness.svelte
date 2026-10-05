<!--
  Test harness: renders CreateButtonProgress the way CompactWorkspaceInitializer
  does — the real Button through `children`, with the wrapper-provided `label`
  snippet inside the button's content — so tests can assert where the bar
  lands relative to the Button's internal slots.
-->
<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import CreateButtonProgress from '../../CreateButtonProgress.svelte';

  let { progressId, fallbackLabel }: { progressId: string; fallbackLabel: string } = $props();
</script>

<CreateButtonProgress {progressId} {fallbackLabel}>
  {#snippet children(label)}
    <Button variant="primary" disabled>
      <span>{@render label()}</span>
    </Button>
  {/snippet}
</CreateButtonProgress>
