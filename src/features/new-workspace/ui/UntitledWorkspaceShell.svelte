<script lang="ts">
  import SimpleRichInput from '$lib/components/chat/input/SimpleRichInput.svelte';
  import type { ContextItem } from '$lib/components/chat/input/context-api';
  import type { StackedMenuGroup } from '$lib/components/ui/menu';
  import { faFolderOpen, faFolderPlus, faGithub } from '$lib/icons/phosphor-icons';
  import StreamingStatus from '$lib/components/chat/StreamingStatus.svelte';
  import { CHAT_TRANSCRIPT_OVERFLOW_CLASS } from '$lib/components/chat/chat-queue-edge-layout';
  import { Button } from '$lib/components/ui/button';
  import SidebarSkeleton from '$lib/components/workspace/SidebarSkeleton.svelte';
  import WorkspaceLayout from '$lib/components/workspace/WorkspaceLayout.svelte';
  import WorkspaceSetupCard from '$lib/components/workspace/creation/WorkspaceSetupCard.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import {
    hasUnsavedInput,
    type Capability,
    type ControllerState,
    type DraftInput,
  } from '../controller';
  import CapabilityStrip from './CapabilityStrip.svelte';
  import CoordinatorPanel from './CoordinatorPanel.svelte';
  import SourceCard, { type SourcePickerMode } from './SourceCard.svelte';
  import { coordinatorStateFor, isProgressPhase, type NewWorkspacePresentation } from './types';

  interface Props {
    state: ControllerState;
    presentation?: NewWorkspacePresentation;
    onEdit?: (patch: Partial<DraftInput>) => void;
    onStart?: (requiredCapabilities: Capability[]) => void;
    onRetry?: () => void;
    onReconnect?: () => void;
    onAcceptRemote?: () => void;
    onKeepLocal?: () => void;
    onAddFiles?: () => void;
    onChooseNewFolder?: (name: string) => void;
    onSourceSelected?: (source: DraftInput['source']) => void;
    onRecheckCapabilities?: () => void;
    onProviderSelected?: (providerId: string) => void;
  }

  let {
    state: controllerState,
    presentation = {},
    onEdit,
    onStart,
    onRetry,
    onReconnect,
    onAcceptRemote,
    onKeepLocal,
    onAddFiles,
    onChooseNewFolder,
    onSourceSelected,
    onRecheckCapabilities,
    onProviderSelected,
  }: Props = $props();

  const coordinator = $derived({
    ...presentation.coordinator,
    state: presentation.coordinator?.state ?? coordinatorStateFor(controllerState),
  });
  const requiredCapabilities = $derived<Capability[]>(
    presentation.requiredCapabilities ?? ['provider'],
  );
  const missingCapabilities = $derived(
    requiredCapabilities.filter(
      (capability) => controllerState.capabilities[capability] === 'missing',
    ),
  );
  const canStart = $derived(
    (controllerState.phase === 'pristine' || controllerState.phase === 'editing') &&
      controllerState.draft !== null &&
      missingCapabilities.length === 0,
  );
  const saveState = $derived.by(() => {
    if (controllerState.phase === 'offline') return 'unsaved';
    if (controllerState.saveInFlightVersion !== null || hasUnsavedInput(controllerState))
      return 'saving';
    return controllerState.draft ? 'saved' : 'saving';
  });
  const composerLocked = $derived(
    controllerState.phase !== 'pristine' && controllerState.phase !== 'editing',
  );
  const progressId = $derived(controllerState.draft?.operationKey);
  const source = $derived(controllerState.input.source);
  const repoName = $derived.by(() => {
    if (!source) return m.chat_chatPanel_yourProject_fallback();
    if (source.kind === 'github') return `${source.owner}/${source.name}`;
    if (source.kind === 'newFolder') return source.name;
    return (
      source.path.split(/[\\/]/).filter(Boolean).pop() || m.chat_chatPanel_yourProject_fallback()
    );
  });
  const repoPath = $derived(source?.kind === 'local' ? source.path : undefined);
  const branch = $derived(
    source?.kind === 'local' || source?.kind === 'github' ? source.branch : undefined,
  );
  const setupScriptContent = $derived(
    typeof controllerState.input.config.setupScript === 'string'
      ? controllerState.input.config.setupScript
      : presentation.progress?.setup?.error,
  );
  let sourcePickerOpen = $state(false);
  let sourcePickerMode = $state<SourcePickerMode>('github');
  const sourceActionGroups = $derived.by((): StackedMenuGroup[] =>
    composerLocked
      ? []
      : [
          {
            id: 'workspace-source',
            label: m.newWorkspace_source_title(),
            items: [
              {
                id: 'workspace-source-local',
                icon: faFolderOpen,
                label: m.workspace_repoSelector_copyLocalRepo_tab(),
                onSelect: () => openSourcePicker('local'),
              },
              {
                id: 'workspace-source-github',
                icon: faGithub,
                label: m.workspace_repoSelector_pickARepo_tab(),
                onSelect: () => openSourcePicker('github'),
              },
              {
                id: 'workspace-source-new-folder',
                icon: faFolderPlus,
                label: m.newWorkspace_source_newProject_title(),
                onSelect: () => openSourcePicker('new-folder'),
              },
            ],
          },
        ],
  );

  function openSourcePicker(mode: SourcePickerMode): void {
    sourcePickerMode = mode;
    sourcePickerOpen = true;
  }

  function setupStatus(): 'pending' | 'active' | 'done' | 'error' | undefined {
    switch (presentation.progress?.setup?.state) {
      case 'none':
        return undefined;
      case 'running':
        return 'active';
      case 'succeeded':
        return 'done';
      case 'failed':
        return 'error';
      case 'unknown':
        return 'error';
      case undefined:
        return undefined;
    }
  }

  function workspaceStepStatus(): 'pending' | 'active' | 'done' | 'error' {
    if (controllerState.phase === 'failed') return 'error';
    if (controllerState.phase === 'live') return 'done';
    if (isProgressPhase(controllerState)) return 'active';
    return 'pending';
  }

  function contextLinkId(link: DraftInput['contextLinks'][number]): string {
    return `draft-context-${link.kind}-${link.owner}-${link.repo}-${link.number}`;
  }

  function attachmentContextItem(value: unknown, index: number): ContextItem | null {
    if (!value || typeof value !== 'object') return null;
    const item = value as Partial<ContextItem> & { name?: unknown };
    const label =
      typeof item.label === 'string'
        ? item.label
        : typeof item.name === 'string'
          ? item.name
          : null;
    if (!label) return null;
    const id = typeof item.id === 'string' ? item.id : `draft-attachment-${index}`;
    const allowedTypes: ContextItem['type'][] = [
      'file',
      'note',
      'selection',
      'workspace',
      'memory',
      'personality',
      'folder',
    ];
    const type = allowedTypes.includes(item.type as ContextItem['type'])
      ? (item.type as ContextItem['type'])
      : 'file';
    return { ...item, id, label, type } as ContextItem;
  }

  const contextItems = $derived([
    ...controllerState.input.attachments
      .map(attachmentContextItem)
      .filter((item): item is ContextItem => item !== null),
    ...controllerState.input.contextLinks.map((link) => ({
      id: contextLinkId(link),
      type: 'workspace' as const,
      label: `${link.owner}/${link.repo}#${link.number}`,
      description: link.url,
    })),
  ]);

  function start(): void {
    if (canStart) onStart?.(requiredCapabilities);
  }

  function addContextItem(item: ContextItem): void {
    if (
      controllerState.input.attachments.some(
        (value) => attachmentContextItem(value, 0)?.id === item.id,
      )
    )
      return;
    onEdit?.({ attachments: [...controllerState.input.attachments, item] });
  }

  function removeContextItem(id: string): void {
    const contextLinks = controllerState.input.contextLinks.filter(
      (link) => contextLinkId(link) !== id,
    );
    const attachments = controllerState.input.attachments.filter(
      (value, index) => attachmentContextItem(value, index)?.id !== id,
    );
    if (contextLinks.length !== controllerState.input.contextLinks.length)
      onEdit?.({ contextLinks });
    else if (attachments.length !== controllerState.input.attachments.length)
      onEdit?.({ attachments });
  }
</script>

<main
  class="h-full min-h-0 w-full overflow-hidden text-foreground"
  aria-label={m.newWorkspace_shell_ariaLabel()}
  data-controller-phase={controllerState.phase}
  data-save-state={saveState}
>
  {#snippet sidebarContent()}
    <SidebarSkeleton />
  {/snippet}

  {#snippet chatContent()}
    <div class="flex h-full min-h-0 w-full flex-1">
      <div
        class="chat-panel-container group/panel relative z-20 flex h-full w-full min-w-0 flex-col bg-background"
        role="region"
        aria-label={m.notification_specialist_coordinator()}
      >
        <div class="relative z-10 flex min-h-0 w-full flex-1 flex-col">
          <div
            class="flex-1 {CHAT_TRANSCRIPT_OVERFLOW_CLASS}"
            data-testid="chat-transcript-scroll-viewport"
          >
            <div
              class="conversation-column chat-content-measure regular-chat-content-inset mx-auto flex min-h-full w-full min-w-0 flex-col px-4 pt-8 sm:px-6"
              data-testid="chat-transcript-inner"
            >
              <div
                class="workspace-setup-card-alignment pt-16 pb-6"
                data-testid="draft-progress"
                data-setup-state={presentation.progress?.setup?.state}
              >
                {#snippet repoPendingContent()}
                  <SourceCard
                    source={controllerState.input.source}
                    presentation={presentation.source}
                    disabled={composerLocked}
                    pickerOpen={sourcePickerOpen}
                    pickerMode={sourcePickerMode}
                    onPickerOpenChange={(open) => (sourcePickerOpen = open)}
                    {onChooseNewFolder}
                    {onSourceSelected}
                  />
                {/snippet}
                {#key progressId}
                  <WorkspaceSetupCard
                    {repoName}
                    {repoPath}
                    {branch}
                    baseRef="origin/main"
                    specialistName={m.notification_specialist_coordinator()}
                    hasPrompt={Boolean(controllerState.input.intentText.trim())}
                    repoStatus={workspaceStepStatus()}
                    branchStatus={workspaceStepStatus()}
                    agentStatus={workspaceStepStatus()}
                    setupScriptStatus={setupStatus()}
                    {setupScriptContent}
                    skipIsolation={source?.kind === 'local' && source.isolation === 'in-place'}
                    {progressId}
                    {repoPendingContent}
                  />
                {/key}
              </div>

              <CoordinatorPanel presentation={coordinator} {onProviderSelected} />
              <CapabilityStrip
                capabilities={controllerState.capabilities}
                host={presentation.host}
                onRecheck={onRecheckCapabilities}
              />

              {#if presentation.specContent?.trim()}
                <p
                  class="type-caption whitespace-pre-wrap py-2 text-muted-foreground"
                  data-testid="draft-spec-pane"
                >
                  {presentation.specContent}
                </p>
              {/if}

              {#if controllerState.phase === 'failed'}
                <StreamingStatus
                  error={controllerState.error}
                  onRetry={controllerState.retryState ? onRetry : undefined}
                  class="mb-2"
                />
              {:else if controllerState.phase === 'offline'}
                <div class="type-caption flex items-start gap-3 py-2 pr-1" role="alert">
                  <div class="min-w-0 flex-1">
                    <p class="font-medium text-warning">
                      {m.newWorkspace_recovery_offline_title()}
                    </p>
                    <p class="text-muted-foreground">
                      {m.newWorkspace_recovery_offline_description()}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost-light" onclick={onReconnect}>
                    {m.sandbox_newWorkspace_reconnect_label()}
                  </Button>
                </div>
              {:else if controllerState.phase === 'conflict'}
                <div class="type-caption flex items-start gap-3 py-2 pr-1" role="alert">
                  <div class="min-w-0 flex-1">
                    <p class="font-medium text-warning">
                      {m.newWorkspace_recovery_conflict_title()}
                    </p>
                    <p class="text-muted-foreground">
                      {m.newWorkspace_recovery_conflict_description()}
                    </p>
                  </div>
                  <div class="flex shrink-0 flex-wrap gap-1">
                    <Button size="sm" variant="ghost-light" onclick={onAcceptRemote}>
                      {m.newWorkspace_recovery_useRemote_label()}
                    </Button>
                    <Button size="sm" variant="ghost-light" onclick={onKeepLocal}>
                      {m.newWorkspace_recovery_keepLocal_label()}
                    </Button>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </div>

        <div class="conversation-composer relative z-10 w-full" data-testid="draft-composer">
          <div class="composer-prompt-layer relative z-10 w-full">
            <div class="composer-prompt-lane chat-content-measure mx-auto w-full min-w-0">
              <div class="w-full min-w-0">
                {#if saveState === 'unsaved'}
                  <p class="regular-composer-content-inset type-caption pb-1 text-warning">
                    {m.newWorkspace_shell_unsaved_label()}
                  </p>
                {/if}
                <SimpleRichInput
                  value={controllerState.input.intentText}
                  onvaluechange={(intentText) => {
                    if (intentText !== controllerState.input.intentText) onEdit?.({ intentText });
                  }}
                  onsubmit={start}
                  onforcesubmit={start}
                  disabled={!canStart || composerLocked}
                  editableWhileDisabled={!composerLocked}
                  inputLocked={composerLocked}
                  workspace={null}
                  placeholder={m.workspace_phase_planningPlaceholder_subtitle()}
                  {contextItems}
                  oncontextAdd={addContextItem}
                  oncontextRemove={removeContextItem}
                  onAttachFiles={onAddFiles}
                  extraActionGroups={sourceActionGroups}
                  allowEmptySubmit
                  submitTestId="draft-start"
                  selectedModel={typeof controllerState.input.config.model === 'string'
                    ? controllerState.input.config.model
                    : null}
                  onmodelChange={(model) =>
                    onEdit?.({ config: { ...controllerState.input.config, model } })}
                  editorClassName="regular-composer-content-inset w-full"
                  contentInsetClassName="regular-composer-content-inset w-full"
                  actionBarEndClassName="regular-composer-content-inset"
                  edgeDocked
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/snippet}

  <WorkspaceLayout
    sidebar={sidebarContent}
    content={chatContent}
    sidebarStorageKey="new-workspace-left-panel-width"
    sidebarExpandedStorageKey="new-workspace-left-panel-expanded-width"
    startCollapsed
  />
</main>

<style>
  .chat-panel-container {
    container: chat-panel / inline-size;
  }

  .regular-chat-content-inset {
    padding-left: 1rem;
    padding-right: 1rem;
  }

  :global(.regular-composer-content-inset) {
    padding-right: 1rem !important;
    padding-left: 1rem !important;
  }

  .workspace-setup-card-alignment {
    --chat-operational-row-inline-padding: 0.5rem;
    --chat-operational-leading-gap: 0.5rem;
    margin-left: -0.5rem;
    text-align: left;
  }

  @container chat-panel (max-width: 639.98px) {
    .regular-chat-content-inset {
      --chat-operational-row-inline-padding: 0.125rem;
      --chat-operational-leading-gap: 0.625rem;
    }

    .workspace-setup-card-alignment {
      margin-left: 1.5rem;
    }
  }

  @container chat-panel (min-width: 640px) {
    .regular-chat-content-inset {
      padding-left: 3.1rem;
      padding-right: 3.1rem;
    }

    :global(.regular-composer-content-inset) {
      padding-right: 1.5rem !important;
      padding-left: 1.5rem !important;
    }
  }
</style>
