<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'modal-heading-spacing',
    title: 'Modal heading spacing',
    defaultState: 'form',
    states: {
      form: { props: { kind: 'form' } },
      confirm: { props: { kind: 'confirm' } },
      direct: { props: { kind: 'direct' } },
    },
  });
</script>

<script lang="ts">
  import { FormDialog, DestructiveConfirm } from '$lib/components/patterns/confirm';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { m } from '$shared/paraglide/messages.js';

  let { kind = 'form' }: { kind?: 'form' | 'confirm' | 'direct' } = $props();
  let open = $state(true);
  let directOpen = $state(false);
  let accepted = $state(0);
</script>

<div class="min-h-96 p-4">
  {#if kind === 'direct'}
    <Dialog.Root bind:open={directOpen}>
      <Dialog.Trigger>Open dialog</Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Canonical dialog</Dialog.Title>
          <Dialog.Description>Dialog behavior fixture</Dialog.Description>
        </Dialog.Header>
        <Input aria-label="Dialog field" />
        <Button variant="ghost">Nested dialog action</Button>
        <Dialog.Footer>
          <Button variant="destructive" onclick={() => (accepted += 1)}>Delete item</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  {:else}
    <Button onclick={() => (open = true)}>Open fixture</Button>
    {#if kind === 'form'}
      <FormDialog
        bind:open
        title="Edit fixture"
        description="A shared form dialog."
        onSubmit={() => {
          accepted += 1;
          open = false;
        }}
      >
        <Input aria-label="Fixture name" />
      </FormDialog>
    {:else}
      <DestructiveConfirm
        bind:open
        title={m.settings_gitWorkspace_worktreesLocation_confirm_title()}
        description={m.settings_gitWorkspace_worktreesLocation_confirm_message()}
        confirmLabel="Confirm"
        destructive={false}
        onConfirm={() => {
          accepted += 1;
          open = false;
        }}
      />
    {/if}
  {/if}
  <output aria-label="Accepted count">{accepted}</output>
</div>
