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
      wrapped: { props: { kind: 'wrapped' } },
      workspace: { props: { kind: 'workspace', inline: true } },
      release: { props: { kind: 'release', inline: true } },
      replace: { props: { kind: 'replace', inline: true } },
      stacked: { props: { kind: 'stacked' } },
    },
  });
</script>

<script lang="ts">
  import { FormDialog, DestructiveConfirm } from '$lib/components/patterns/confirm';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import NewSpaceModal from '$lib/components/modals/NewSpaceModal.svelte';
  import ReleaseNotesModal from '$lib/components/modals/ReleaseNotesModal.svelte';
  import ReplaceAgentModal from '$lib/components/modals/ReplaceAgentModal.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let {
    kind = 'form',
    inline = false,
    primaryDisabled = false,
    focusField = false,
  }: {
    kind?:
      'form' | 'confirm' | 'direct' | 'wrapped' | 'workspace' | 'release' | 'replace' | 'stacked';
    inline?: boolean;
    primaryDisabled?: boolean;
    focusField?: boolean;
  } = $props();
  let open = $state(true);
  let directOpen = $state(false);
  let accepted = $state(0);
  let inputRef = $state<HTMLInputElement | null>(null);
</script>

<div class="min-h-96 p-4">
  {#if kind === 'stacked'}
    {#each [1, 2] as index (index)}
      <Dialog.Root open staticPosition>
        <Dialog.Content>
          <Dialog.Title>Static dialog {index}</Dialog.Title>
          <Dialog.Description>Inline dialog fixture</Dialog.Description>
          <Button>Inside action</Button>
        </Dialog.Content>
      </Dialog.Root>
    {/each}
  {:else if kind === 'workspace'}
    <NewSpaceModal bind:open static={inline}>
      {#snippet initializer()}
        <Input aria-label="Workspace task" />
        <Button data-dialog-primary-action disabled={primaryDisabled}>Create workspace</Button>
      {/snippet}
    </NewSpaceModal>
  {:else if kind === 'release'}
    <ReleaseNotesModal bind:open static={inline} releaseNotes={null} />
  {:else if kind === 'replace'}
    <ReplaceAgentModal bind:open static={inline} agentName="Fixture agent" />
  {:else if kind === 'direct' || kind === 'wrapped'}
    <Dialog.Root bind:open={directOpen}>
      <Dialog.Trigger>Open dialog</Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>
            {kind === 'wrapped'
              ? 'A longer dialog heading that wraps onto multiple lines in a narrow window'
              : 'Canonical dialog'}
          </Dialog.Title>
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
        canSubmit={!primaryDisabled}
        initialFocus={focusField ? inputRef : null}
        onSubmit={() => {
          accepted += 1;
          open = false;
        }}
      >
        <Input bind:ref={inputRef} aria-label="Fixture name" />
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
