<script lang="ts">
  import { ContentDialog } from './index';
  import { Button } from '$lib/components/ui/button';
  import { FormActions } from '$lib/components/patterns/form';
  let { busy = false }: { busy?: boolean } = $props();
  let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open details</Button>
<ContentDialog
  bind:open
  title="Review interrupted work"
  description="Choose what should continue."
  {busy}
>
  {#each Array.from({ length: 40 }) as _, index}
    <p class="type-body">Agent {index + 1}: detailed supporting context for a long-running task.</p>
  {/each}
  {#snippet footer()}
    <FormActions>
      {#snippet destructive()}<Button variant="ghost-danger" disabled={busy}
          >Abandon remaining work</Button
        >{/snippet}
      {#snippet secondary()}<Button variant="ghost" disabled={busy} onclick={() => (open = false)}
          >Decide later</Button
        >{/snippet}
      {#snippet primary()}<Button variant="primary" disabled={busy}
          >Resume the selected agents</Button
        >{/snippet}
    </FormActions>
  {/snippet}
</ContentDialog>
