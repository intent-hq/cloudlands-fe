<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import NewSpaceModal from '../NewSpaceModal.svelte';
  import Pickers from '$lib/components/workspace/initializer/initializer-pickers.preview.svelte';

  let { standalone = false }: { standalone?: boolean } = $props();
  let open = $state(false);
  let closes = $state(0);
</script>

<div class="p-8">
  {#if standalone}
    <Pickers />
  {:else}
    <Button onclick={() => (open = true)}>Open workspace form</Button>
    <NewSpaceModal bind:open onClose={() => (closes += 1)}>
      {#snippet initializer()}
        <Pickers />
        <Textarea aria-label="Workspace prompt" rows={5} />
      {/snippet}
    </NewSpaceModal>
    <output data-testid="workspace-close-count">{closes}</output>
  {/if}
</div>
