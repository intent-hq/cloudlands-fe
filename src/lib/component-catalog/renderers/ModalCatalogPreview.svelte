<script lang="ts">
  import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { InputMessage } from '$lib/components/ui/input-message';
  import SizeProvider from '$lib/components/ui/SizeProvider.svelte';
  import { DestructiveConfirm, FormDialog } from '$lib/components/patterns/confirm';
  import InputDialog from '$lib/components/modals/InputDialog.svelte';
  import MessageDialog from '$lib/components/modals/MessageDialog.svelte';
  import DeleteWarningDialog from '$lib/components/modals/DeleteWarningDialog.svelte';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import QuitConfirmationModal from '$lib/components/modals/QuitConfirmationModal.svelte';
  import ReplaceAgentModal from '$lib/components/modals/ReplaceAgentModal.svelte';
  import ReleaseNotesModal from '$lib/components/modals/ReleaseNotesModal.svelte';
  import ImportWorkspaceModal from '$lib/components/modals/ImportWorkspaceModal.svelte';
  import TransferWorkspaceModal from '$lib/components/modals/TransferWorkspaceModal.svelte';
  import HarnessFeaturesModal from '$lib/components/chat/HarnessFeaturesModal.svelte';
  import ModelSwitchConfirmDialog from '$lib/components/chat/ModelSwitchConfirmDialog.svelte';
  import DismissProposalConfirmDialog from '$lib/components/chat/proposals/DismissProposalConfirmDialog.svelte';
  import DismissQuestionsConfirmDialog from '$lib/components/chat/questions/DismissQuestionsConfirmDialog.svelte';
  import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

  let { fixture }: { componentId: 'modals'; fixture: UiComponentFixture } = $props();

  const primitiveStates = [
    ['default', 'Default'],
    ['no-description', 'No description'],
    ['title-only', 'Title only'],
    ['with-icon-header', 'Icon header'],
    ['size-sm', 'Small'],
    ['size-lg', 'Large'],
    ['compact-density', 'Compact density'],
    ['long-content-scrolling', 'Long content scrolling'],
    ['busy', 'Busy'],
    ['invalid', 'Invalid'],
    ['destructive', 'Destructive'],
    ['disabled-close', 'Disabled close'],
    ['nested-content', 'Nested content'],
    ['zoom-200', '200% zoom'],
    ['reduced-motion', 'Reduced motion'],
  ] as const;
  type ModalState = (typeof primitiveStates)[number][0];

  const productStates = [
    ['destructive-confirm-default', 'DestructiveConfirm — default'],
    ['destructive-confirm-typed-name', 'DestructiveConfirm — typed name'],
    ['destructive-confirm-busy', 'DestructiveConfirm — busy'],
    ['form-dialog-default', 'FormDialog — default'],
    ['form-dialog-busy', 'FormDialog — busy'],
    ['form-dialog-invalid', 'FormDialog — invalid'],
    ['input-dialog', 'InputDialog'],
    ['message-dialog', 'MessageDialog'],
    ['delete-warning-dialog', 'DeleteWarningDialog'],
    ['bulk-action-confirm-dialog', 'BulkActionConfirmDialog'],
    ['quit-confirmation-modal', 'QuitConfirmationModal'],
    ['replace-agent-modal', 'ReplaceAgentModal'],
    ['release-notes-modal', 'ReleaseNotesModal'],
    ['import-workspace-modal', 'ImportWorkspaceModal'],
    ['transfer-workspace-modal', 'TransferWorkspaceModal'],
    ['harness-features-modal', 'HarnessFeaturesModal'],
    ['model-switch-confirm-dialog', 'ModelSwitchConfirmDialog'],
    ['dismiss-proposal-confirm-dialog', 'DismissProposalConfirmDialog'],
    ['dismiss-questions-confirm-dialog', 'DismissQuestionsConfirmDialog'],
  ] as const;
  type ProductModalState = (typeof productStates)[number][0];

  const notRenderable = [
    [
      'ConfirmHost',
      'Its singleton request queue cannot expose confirm, prompt, alert, and busy concurrently.',
    ],
    [
      'NewSpaceModal',
      'Its full workspace initializer transitively loads daemon and Monaco worker integrations.',
    ],
    [
      'SetupScriptModal',
      'Its production CodeEditor requires Monaco worker entrypoints unavailable in the catalog runtime.',
    ],
    [
      'PullConflictDialog',
      'Mounting requires initialized editor-discovery Redux state and dispatches native editor discovery.',
    ],
    ['InterruptedAgentsModal', 'It portals a full-screen takeover directly to document.body.'],
    ['SetupPromptDialog', 'Visibility and content are owned by routed Redux connection state.'],
    [
      'WorkspaceWarningDialogs',
      'This global Redux host has no prop seam; its child DeleteWarningDialog is shown above.',
    ],
    ['FeatureCodeDialog', 'Opening immediately fetches active feature codes from the daemon.'],
    ['DirectoryPickerModal', 'Opening immediately requests a daemon-host filesystem listing.'],
    ['AddRemoteSetupModal', 'It portals a bespoke full-screen form directly to document.body.'],
  ] as const;

  const quitPayload = {
    requestId: 'catalog-quit',
    interrupted: [
      { agentId: 'agent-local', agentName: 'Build reviewer', workspaceName: 'Design system' },
    ],
    keepRunning: [
      { agentId: 'agent-remote', agentName: 'Remote verifier', workspaceName: 'Release prep' },
    ],
    disruptedBrowserTabs: [
      {
        tabId: 'tab-docs',
        ownerAgentId: 'agent-local',
        ownerAgentName: 'Build reviewer',
        title: 'Component docs',
      },
    ],
  };

  const releaseNotes = {
    version: '2.140.0',
    notes: '## Highlights\n\n- Refined modal compositions\n- Improved keyboard navigation',
    url: 'https://github.com/intent-hq/cloudlands-releases/releases/tag/v2.140.0',
  };
</script>

{#snippet preview(state: ModalState)}
  <div class:modal-zoom-preview={state === 'zoom-200'}>
    <Dialog.Root open staticPosition>
      <Dialog.Content
        size={state === 'size-lg' ? 'lg' : 'sm'}
        closeDisabled={state === 'busy' || state === 'disabled-close'}
        class={state === 'long-content-scrolling' ? 'max-h-72' : undefined}
      >
        {#if state === 'with-icon-header'}
          <Dialog.Header class="flex-row items-start">
            <span class="mt-0.5 text-danger"><Fa icon={faCircleExclamation} /></span>
            <div class="grid gap-1.5">
              <Dialog.Title>Review this change</Dialog.Title>
              <Dialog.Description
                >Check the affected workspace before continuing.</Dialog.Description
              >
            </div>
          </Dialog.Header>
        {:else if state === 'title-only'}
          <Dialog.Title>Dialog title</Dialog.Title>
        {:else}
          <Dialog.Header>
            <Dialog.Title
              >{state === 'destructive' ? 'Delete workspace?' : 'Edit workspace'}</Dialog.Title
            >
            {#if state !== 'no-description'}
              <Dialog.Description>
                {state === 'invalid'
                  ? 'Resolve the validation error before saving.'
                  : 'Update the workspace details and save your changes.'}
              </Dialog.Description>
            {/if}
          </Dialog.Header>
        {/if}

        {#if state === 'no-description'}
          <p class="type-body text-muted-foreground">
            The description slot is intentionally omitted.
          </p>
        {:else if state === 'long-content-scrolling'}
          <div class="grid gap-3">
            {#each Array.from({ length: 10 }) as _, index (index)}
              <p class="type-body">Workspace detail row {index + 1} remains inside the dialog.</p>
            {/each}
          </div>
        {:else if state === 'invalid'}
          <div>
            <Input aria-label="Workspace name" aria-invalid="true" value="" />
            <InputMessage tone="error">A workspace name is required.</InputMessage>
          </div>
        {:else if state === 'nested-content'}
          <div class="grid gap-3">
            <Input aria-label="Workspace name" value="Design system" />
            <Input aria-label="Workspace path" value="/workspaces/design-system" />
          </div>
        {:else if state !== 'title-only'}
          <p class="type-body text-muted-foreground">
            {state === 'destructive'
              ? 'This removes local workspace data and cannot be undone.'
              : 'The dialog body uses the standard content composition.'}
          </p>
        {/if}

        {#if state !== 'title-only'}
          <Dialog.Footer>
            <Button variant="ghost" disabled={state === 'busy'}>Cancel</Button>
            <Button
              variant={state === 'destructive' ? 'destructive' : 'default'}
              loading={state === 'busy'}
              disabled={state === 'invalid'}
            >
              {state === 'destructive' ? 'Delete workspace' : 'Save changes'}
            </Button>
          </Dialog.Footer>
        {/if}
      </Dialog.Content>
    </Dialog.Root>
  </div>
{/snippet}

{#snippet productPreview(state: ProductModalState)}
  {#if state === 'destructive-confirm-default'}
    <DestructiveConfirm
      open
      static
      title="Delete workspace?"
      description="This action cannot be undone."
      confirmLabel="Delete workspace"
      onConfirm={() => {}}
    />
  {:else if state === 'destructive-confirm-typed-name'}
    <DestructiveConfirm
      open
      static
      title="Delete Design system?"
      description="Type the workspace name to continue."
      confirmLabel="Delete workspace"
      typedConfirmation="Design system"
      typedLabel="Workspace name"
      onConfirm={() => {}}
    />
  {:else if state === 'destructive-confirm-busy'}
    <DestructiveConfirm
      open
      static
      busy
      title="Deleting workspace"
      description="Local workspace data is being removed."
      confirmLabel="Delete workspace"
      onConfirm={() => {}}
    />
  {:else if state === 'form-dialog-default'}
    <FormDialog
      open
      static
      title="Save workspace"
      description="Review the workspace details before saving."
      onSubmit={() => {}}
    />
  {:else if state === 'form-dialog-busy'}
    <FormDialog
      open
      static
      busy
      title="Saving workspace"
      description="Your changes are being saved."
      onSubmit={() => {}}
    />
  {:else if state === 'form-dialog-invalid'}
    <FormDialog
      open
      static
      canSubmit={false}
      title="Save workspace"
      description="A workspace name is required."
      onSubmit={() => {}}
    />
  {:else if state === 'input-dialog'}
    <InputDialog
      open
      static
      title="Rename workspace"
      description="Enter a new workspace name."
      placeholder="Workspace name"
    />
  {:else if state === 'message-dialog'}
    <MessageDialog
      open
      static
      title="Workspace moved"
      message="The workspace is ready on the selected connection."
      buttons={['Dismiss', 'Open workspace']}
    />
  {:else if state === 'delete-warning-dialog'}
    <DeleteWarningDialog
      open
      static
      agentNames={['Implementor', 'Verifier']}
      hookNames={['Watch release build']}
      openPrs={[{ number: 418, title: 'Refine modal catalog', status: 'Open', url: '' }]}
    />
  {:else if state === 'bulk-action-confirm-dialog'}
    <BulkActionConfirmDialog
      open
      static
      title="Archive selected workspaces?"
      description="The selected workspaces will move to the archive."
      confirmText="Archive workspaces"
      variant="destructive"
      activeAgentCount={2}
      activeHookCount={1}
    />
  {:else if state === 'quit-confirmation-modal'}
    <QuitConfirmationModal open static payload={quitPayload} />
  {:else if state === 'replace-agent-modal'}
    <ReplaceAgentModal open static agentName="Catalog implementor" specialist="implementor" />
  {:else if state === 'release-notes-modal'}
    <ReleaseNotesModal open static {releaseNotes} />
  {:else if state === 'import-workspace-modal'}
    <ImportWorkspaceModal
      open
      step="result"
      runStatus="succeeded"
      workspaceTitle="Imported workspace"
      interruptedAgents={['Review agent']}
    />
  {:else if state === 'transfer-workspace-modal'}
    <TransferWorkspaceModal open workspaceTitle="Design system" />
  {:else if state === 'harness-features-modal'}
    <HarnessFeaturesModal open static version="2.3" features={{ browser: true, hooks: true }} />
  {:else if state === 'model-switch-confirm-dialog'}
    <ModelSwitchConfirmDialog
      open
      static
      isProviderChange
      fromProviderName="Augment"
      fromModelLabel="Auggie"
      toProviderName="OpenAI"
      toModelLabel="GPT-5.6"
    />
  {:else if state === 'dismiss-proposal-confirm-dialog'}
    <DismissProposalConfirmDialog open static />
  {:else}
    <DismissQuestionsConfirmDialog open static />
  {/if}
{/snippet}

<div
  class="grid min-w-0 gap-6"
  data-catalog-renderer-fixture={fixture.id}
  data-catalog-rendered-state={fixture.states.join(' ')}
>
  {#if fixture.id === 'primitive-dialog-matrix'}
    <section class="grid gap-3" aria-labelledby="dialog-primitive-title">
      <h2 id="dialog-primitive-title" class="text-base font-medium">Dialog primitive</h2>
      <div class="modal-preview-grid">
        {#each primitiveStates as [state, label] (state)}
          <article class="grid min-w-0 content-start gap-2" data-modal-preview={state}>
            <h3 class="text-xs font-medium text-muted-foreground">{label}</h3>
            <div class="relative min-h-88 overflow-hidden rounded-md bg-muted/40 py-4">
              {#if state === 'compact-density'}
                <SizeProvider size="compact">{@render preview(state)}</SizeProvider>
              {:else}
                {@render preview(state)}
              {/if}
            </div>
          </article>
        {/each}
      </div>
    </section>
  {:else}
    <section class="grid gap-3" aria-labelledby="product-modals-title">
      <h2 id="product-modals-title" class="text-base font-medium">Product modals</h2>
      <div class="modal-preview-grid">
        {#each productStates as [state, label] (state)}
          <article class="grid min-w-0 content-start gap-2" data-modal-preview={state}>
            <h3 class="text-xs font-medium text-muted-foreground">{label}</h3>
            <div
              class:legacy-static-frame={state === 'import-workspace-modal' ||
                state === 'transfer-workspace-modal'}
              class="relative min-h-96 overflow-hidden rounded-md bg-muted/40 py-4"
            >
              {@render productPreview(state)}
            </div>
          </article>
        {/each}
      </div>
      <aside
        class="rounded-md border border-border bg-muted/40 p-4"
        aria-labelledby="not-renderable-title"
      >
        <h3 id="not-renderable-title" class="text-sm font-medium">Not renderable in catalog</h3>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {#each notRenderable as [name, reason] (name)}
            <li><strong class="font-medium text-foreground">{name}</strong> — {reason}</li>
          {/each}
        </ul>
      </aside>
    </section>
  {/if}
</div>

<style>
  .modal-preview-grid {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(24rem, 100%), 1fr));
    gap: 1rem;
  }

  .modal-zoom-preview {
    width: 50%;
    zoom: 2;
  }

  .legacy-static-frame {
    transform: translateZ(0);
  }
</style>
