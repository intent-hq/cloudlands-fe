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
  import NewSpaceModal from '$lib/components/modals/NewSpaceModal.svelte';
  import SetupScriptModal from '$lib/components/modals/SetupScriptModal.svelte';
  import InterruptedAgentsModal from '$lib/components/modals/InterruptedAgentsModal.svelte';
  import AddRemoteSetupModal from '$lib/components/workspace/initializer/AddRemoteSetupModal.svelte';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Label } from '$lib/components/ui/label';
  import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

  let { fixture }: { componentId: 'modals'; fixture: UiComponentFixture } = $props();

  import { ConfirmRequestView } from '$lib/components/patterns/confirm';
  import WorkspaceWarningDialogs from '$lib/components/modals/WorkspaceWarningDialogs.svelte';
  import SetupPromptDialog from '$lib/components/modals/SetupPromptDialog.svelte';
  import PullConflictDialog from '$lib/components/modals/PullConflictDialog.svelte';
  import FeatureCodeDialog from '$lib/components/modals/FeatureCodeDialog.svelte';
  import SetPrimaryClientConfirmDialog from '$lib/components/workspace/SetPrimaryClientConfirmDialog.svelte';

  const uid = $props.id();
  const portalId = (state: string) => `${uid}-${state}-portal`;

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
    ['confirm-host-confirm', 'ConfirmHost — confirm'],
    ['confirm-host-prompt', 'ConfirmHost — prompt'],
    ['confirm-host-alert', 'ConfirmHost — alert'],
    ['confirm-host-busy', 'ConfirmHost — busy'],
    ['workspace-warning-dialogs', 'WorkspaceWarningDialogs'],
    ['setup-prompt-dialog', 'SetupPromptDialog'],
    ['pull-conflict-dialog', 'PullConflictDialog'],
    ['feature-code-dialog', 'FeatureCodeDialog'],
    ['directory-picker-modal', 'DirectoryPickerModal'],
    ['set-primary-client-confirm-dialog', 'SetPrimaryClientConfirmDialog'],

    ['destructive-confirm-default', 'DestructiveConfirm — default'],
    ['destructive-confirm-busy', 'DestructiveConfirm — busy'],
    ['form-dialog-default', 'FormDialog — default'],
    ['form-dialog-busy', 'FormDialog — busy'],
    ['form-dialog-invalid', 'FormDialog — invalid'],
    ['input-dialog', 'InputDialog'],
    ['message-dialog', 'MessageDialog'],
    ['delete-warning-dialog', 'DeleteWarningDialog'],
    ['archive-warning-dialog', 'DeleteWarningDialog — archive'],
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
    ['new-space-modal', 'NewSpaceModal'],
    ['setup-script-modal', 'SetupScriptModal'],
    ['interrupted-agents-modal', 'InterruptedAgentsModal'],
    ['add-remote-setup-modal', 'AddRemoteSetupModal'],
  ] as const;
  type ProductModalState = (typeof productStates)[number][0];

  const quitPayload = {
    requestId: 'catalog-quit',
    interrupted: [
      {
        agentId: 'agent-local',
        agentName: 'Build reviewer',
        workspaceId: 'design',
        workspaceName: 'Design system',
      },
    ],
    disruptedBrowserTabs: [
      {
        tabId: 'tab-docs',
        ownerAgentId: 'agent-local',
        ownerAgentName: 'Build reviewer',
        title: 'Component docs',
        url: 'https://intent.app/docs/components',
        workspaceId: 'design',
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
              <Dialog.Description class="sr-only"
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
              <Dialog.Description class="sr-only">
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
  {#if state === 'confirm-host-confirm' || state === 'confirm-host-busy'}
    <ConfirmRequestView
      static
      busy={state === 'confirm-host-busy'}
      request={{
        kind: 'confirm',
        options: {
          title: 'Delete workspace?',
          destructive: true,
          confirmLabel: 'Delete workspace',
        },
      }}
      onAccept={() => {}}
      onCancel={() => {}}
    />
  {:else if state === 'confirm-host-prompt'}
    <ConfirmRequestView
      static
      value="Design system"
      request={{
        kind: 'prompt',
        options: { title: 'Rename workspace', field: { label: 'Workspace name', required: true } },
      }}
      onAccept={() => {}}
      onCancel={() => {}}
    />
  {:else if state === 'confirm-host-alert'}
    <ConfirmRequestView
      static
      request={{
        kind: 'alert',
        options: { title: 'Workspace ready' },
      }}
      onAccept={() => {}}
      onCancel={() => {}}
    />
  {:else if state === 'workspace-warning-dialogs'}
    <WorkspaceWarningDialogs
      staticData={{
        open: true,
        mode: 'archive',
        agents: [{ id: 'catalog-reviewer', name: 'Reviewer', state: 'running' }],
        hookNames: ['Watch release build'],
      }}
    />
  {:else if state === 'setup-prompt-dialog'}
    <SetupPromptDialog staticData={{ backendLabel: 'Development server' }} />
  {:else if state === 'pull-conflict-dialog'}
    <PullConflictDialog
      open
      static
      staticData={{ editors: [] }}
      branchName="design-system"
      repoPath="/workspaces/design-system"
      error={'CONFLICT (content): Merge conflict in src/components/Sidebar.svelte\nCONFLICT (content): Merge conflict in src/styles/tokens.css'}
    />
  {:else if state === 'feature-code-dialog'}
    <FeatureCodeDialog
      open
      static
      staticData={{ activeFeatures: ['Workspace sharing', 'Advanced previews'] }}
    />
  {:else if state === 'directory-picker-modal'}
    {#await import('$features/onboarding/messages/DirectoryPickerModal.svelte') then module}
      <module.default
        open
        static
        staticData={{
          listing: {
            path: '/home/developer',
            parent: '/home',
            home: '/home/developer',
            entries: [
              {
                name: 'Projects',
                path: '/home/developer/Projects',
                isDirectory: true,
                isGitRepo: false,
              },
              {
                name: 'design-system',
                path: '/home/developer/design-system',
                isDirectory: true,
                isGitRepo: true,
              },
            ],
          },
        }}
        onSelect={() => {}}
        onClose={() => {}}
      />
    {/await}
  {:else if state === 'set-primary-client-confirm-dialog'}
    <SetPrimaryClientConfirmDialog open static currentHost="Studio Mac" />
  {:else if state === 'destructive-confirm-default'}
    <DestructiveConfirm
      open
      static
      title="Delete workspace?"
      confirmLabel="Delete workspace"
      onConfirm={() => {}}
    >
      {#snippet details()}
        <p class="type-body">This action cannot be undone.</p>
      {/snippet}
    </DestructiveConfirm>
  {:else if state === 'destructive-confirm-busy'}
    <DestructiveConfirm
      open
      static
      busy
      title="Deleting workspace"
      confirmLabel="Delete workspace"
      onConfirm={() => {}}
    >
      {#snippet details()}
        <p class="type-body">Local workspace data is being removed.</p>
      {/snippet}
    </DestructiveConfirm>
  {:else if state === 'form-dialog-default'}
    <FormDialog open static title="Save workspace" onSubmit={() => {}}>
      <p class="type-body">Review the workspace details before saving.</p>
    </FormDialog>
  {:else if state === 'form-dialog-busy'}
    <FormDialog open static busy title="Saving workspace" onSubmit={() => {}}>
      <p class="type-body">Your changes are being saved.</p>
    </FormDialog>
  {:else if state === 'form-dialog-invalid'}
    <FormDialog open static canSubmit={false} title="Save workspace" onSubmit={() => {}}>
      <p class="type-body">A workspace name is required.</p>
    </FormDialog>
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
  {:else if state === 'delete-warning-dialog' || state === 'archive-warning-dialog'}
    <DeleteWarningDialog
      open
      static
      mode={state === 'archive-warning-dialog' ? 'archive' : 'delete'}
      agents={[
        {
          id: 'catalog-implementor',
          name: 'Implementor',
          specialist: 'implementor',
          state: 'running',
        },
        { id: 'catalog-verifier', name: 'Verifier', specialist: 'verifier', state: 'running' },
      ]}
      localChanges={{
        hasUnpushedCommits: true,
        hasUncommittedChanges: true,
        roots: [
          {
            kind: 'primary',
            path: '/workspace/catalog',
            branch: 'refine-modals',
            hasRemoteRefs: true,
            unpushedCount: 2,
            uncommittedCount: 1,
          },
        ],
      }}
      hookNames={['Watch release build']}
      openPrs={[{ number: 418, title: 'Refine modal catalog', status: 'Open', url: '' }]}
      guests={{ collaboratorCount: 2, openInviteCount: 1 }}
    />
  {:else if state === 'bulk-action-confirm-dialog'}
    <BulkActionConfirmDialog
      open
      static
      title="Archive selected workspaces?"
      description="The selected workspaces will move to the archive."
      confirmText="Archive workspaces"
      variant="destructive"
      mode="archive"
      activeAgentCount={2}
      activeHookCount={1}
      guestCount={3}
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
  {:else if state === 'dismiss-questions-confirm-dialog'}
    <DismissQuestionsConfirmDialog open static />
  {:else if state === 'new-space-modal'}
    <NewSpaceModal open static>
      {#snippet initializer()}
        <div class="grid gap-4">
          <Textarea
            aria-label="Initial prompt"
            value="Review the design system and refine the workspace navigation."
            rows={4}
          />
          <div class="grid gap-2">
            <Label for={`${uid}-repo`}>Repository</Label>
            <Input id={`${uid}-repo`} value="intent-hq/intent" />
            <Label for={`${uid}-branch`}>Branch</Label>
            <Input id={`${uid}-branch`} value="design-system" />
          </div>
          <div class="rounded-md border border-border p-3">
            <p class="type-body text-muted-foreground font-normal">Implementor</p>
            <p class="text-xs text-muted-foreground">OpenAI · GPT-5.6 · High reasoning</p>
          </div>
          <Button variant="outline">Setup script: pnpm install</Button>
          <Button variant="primary">Create workspace</Button>
        </div>
      {/snippet}
    </NewSpaceModal>
  {:else if state === 'setup-script-modal'}
    <SetupScriptModal
      open
      static
      value={'#!/bin/bash\npnpm install\npnpm run dev'}
      scriptName="Frontend setup"
    >
      {#snippet editor(value, onChange)}
        <div class="grid gap-3">
          <p class="type-body text-muted-foreground font-normal">Frontend setup</p>
          <Textarea
            aria-label="Setup script"
            {value}
            oninput={(event) => onChange(event.currentTarget.value)}
            rows={10}
            class="font-mono"
          />
        </div>
      {/snippet}
    </SetupScriptModal>
  {:else if state === 'interrupted-agents-modal'}
    <InterruptedAgentsModal
      open
      inline
      portalTarget={`#${portalId(state)}`}
      agents={[
        {
          agentId: 'interrupted-implementor',
          agentName: 'Implementor',
          workspaceId: 'design',
          workspaceName: 'Design system',
          prevStatus: 'running',
          interruptedAt: '2026-09-11T12:00:00Z',
        },
        {
          agentId: 'interrupted-reviewer',
          agentName: 'Reviewer',
          workspaceId: 'release',
          workspaceName: 'Release prep',
          prevStatus: 'waiting',
          interruptedAt: '2026-09-11T12:00:00Z',
        },
      ]}
    />
  {:else if state === 'add-remote-setup-modal'}
    <AddRemoteSetupModal
      isOpen
      inline
      portalTarget={`#${portalId(state)}`}
      initialSetup={{
        name: 'Development server',
        host: 'dev.example.com',
        port: 22,
        username: 'developer',
        workspacePath: '/home/developer/intent',
        branch: 'main',
      }}
      onclose={() => {}}
      onsave={() => {}}
    />
  {/if}
{/snippet}

<div
  class="grid min-w-0 gap-6"
  data-catalog-renderer-fixture={fixture.id}
  data-catalog-rendered-state={fixture.states.join(' ')}
>
  {#if fixture.id === 'primitive-dialog-matrix'}
    <section class="grid gap-4" aria-labelledby="dialog-primitive-title">
      <h2 id="dialog-primitive-title" class="type-body text-muted-foreground font-normal">
        Dialog primitive
      </h2>
      <div class="modal-preview-grid">
        {#each primitiveStates as [state, label] (state)}
          <article class="grid min-w-0 content-start gap-2" data-modal-preview={state}>
            <h3 class="type-caption text-muted-foreground font-normal">{label}</h3>
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
    <section class="grid gap-4" aria-labelledby="product-modals-title">
      <h2 id="product-modals-title" class="type-body text-muted-foreground font-normal">
        Product modals
      </h2>
      <div class="modal-preview-grid">
        {#each productStates as [state, label] (state)}
          <article class="grid min-w-0 content-start gap-2" data-modal-preview={state}>
            <h3 class="type-caption text-muted-foreground font-normal">{label}</h3>
            <div
              class:legacy-static-frame={state === 'import-workspace-modal' ||
                state === 'transfer-workspace-modal'}
              class="relative min-h-96 overflow-hidden rounded-md bg-muted/40 py-4"
            >
              <div id={portalId(state)}></div>
              {@render productPreview(state)}
            </div>
          </article>
        {/each}
      </div>
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
