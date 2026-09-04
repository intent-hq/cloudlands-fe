<script lang="ts">
  import Fa from 'svelte-fa';
  import { faPaperclip, faTriangleExclamation } from '$lib/icons/phosphor-icons';
  import EditableName from '$lib/components/ui/EditableName.svelte';
  import RichTextarea from '$lib/components/ui/RichTextarea.svelte';
  import { Button } from '$lib/components/ui/button';
  import IssueSuggestions from '$lib/components/workspace/initializer/IssueSuggestions.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import {
    hasUnsavedInput,
    type Capability,
    type ControllerState,
    type DraftInput,
  } from '../controller';
  import CapabilityStrip from './CapabilityStrip.svelte';
  import CoordinatorPanel from './CoordinatorPanel.svelte';
  import SourceCard from './SourceCard.svelte';
  import {
    coordinatorStateFor,
    isEditorEnabled,
    isProgressPhase,
    type NewWorkspacePresentation,
  } from './types';

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
    onChooseLocal?: () => void;
    onChooseGitHub?: () => void;
    onChooseNewFolder?: (name: string) => void;
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
    onChooseLocal,
    onChooseGitHub,
    onChooseNewFolder,
    onRecheckCapabilities,
    onProviderSelected,
  }: Props = $props();

  let showSuggestions = $state(false);

  const coordinator = $derived({
    ...presentation.coordinator,
    state: presentation.coordinator?.state ?? coordinatorStateFor(controllerState),
  });
  const editorEnabled = $derived(isEditorEnabled(controllerState));
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

  function progressLabel(): string {
    switch (controllerState.phase) {
      case 'starting':
        return m.newWorkspace_progress_checkingPrerequisites_label();
      case 'promoting':
        return m.newWorkspace_progress_promoting_label();
      case 'adopting':
        return m.newWorkspace_progress_adopting_label();
      case 'placingAttachments':
        return m.newWorkspace_progress_attachments_label();
      case 'sending':
        return m.newWorkspace_progress_sending_label();
      default:
        return m.newWorkspace_progress_preparing_label();
    }
  }

  function setupLabel(): string | undefined {
    switch (presentation.progress?.setup?.state) {
      case 'none':
        return undefined;
      case 'running':
        return m.newWorkspace_progress_setupRunning_label();
      case 'succeeded':
        return m.newWorkspace_progress_setupSucceeded_label();
      case 'failed':
        return m.newWorkspace_progress_setupFailed_label();
      case 'unknown':
        return m.newWorkspace_progress_setupUnknown_label();
      case undefined:
        return undefined;
    }
  }

  function start(): void {
    if (canStart) onStart?.(requiredCapabilities);
  }

  function appendSuggestion(text: string): void {
    const separator = controllerState.input.intentText.trim() ? '\n\n' : '';
    onEdit?.({ intentText: `${controllerState.input.intentText}${separator}${text}` });
    showSuggestions = false;
  }
</script>

<main
  class="new-workspace-shell h-full min-h-[36rem] overflow-hidden rounded-xl border border-border bg-sidebar text-foreground"
  aria-label={m.newWorkspace_shell_ariaLabel()}
  data-controller-phase={controllerState.phase}
>
  <header
    class="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-background px-4"
  >
    <EditableName
      value={controllerState.input.title ?? m.ui_editableName_placeholder()}
      onSave={(title) => onEdit?.({ title })}
      disabled={!editorEnabled}
      textClass="text-base font-semibold"
      maxWidth={360}
    />
    <span
      class="rounded-full px-2 py-1 text-xs {saveState === 'unsaved'
        ? 'bg-warning/15 text-warning-foreground'
        : 'bg-muted text-muted-foreground'}"
      data-save-state={saveState}
    >
      {saveState === 'saved'
        ? m.newWorkspace_shell_saved_label()
        : saveState === 'unsaved'
          ? m.newWorkspace_shell_unsaved_label()
          : m.newWorkspace_shell_saving_label()}
    </span>
  </header>

  <div class="shell-body grid min-h-0 gap-3 p-3">
    <aside
      class="grid min-h-0 content-start gap-3 overflow-auto"
      aria-label={m.newWorkspace_source_title()}
    >
      <SourceCard
        source={controllerState.input.source}
        presentation={presentation.source}
        disabled={!editorEnabled}
        {onChooseLocal}
        {onChooseGitHub}
        {onChooseNewFolder}
      />
      <CapabilityStrip
        capabilities={controllerState.capabilities}
        hostName={presentation.hostName}
        onRecheck={onRecheckCapabilities}
      />

      {#if presentation.specContent?.trim()}
        <section class="rounded-xl border border-border bg-card p-4" data-testid="draft-spec-pane">
          <h2 class="text-sm font-semibold">{m.chat_shared_spec_label()}</h2>
          <p class="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
            {presentation.specContent}
          </p>
        </section>
      {/if}
    </aside>

    <div class="grid min-h-0 gap-3 overflow-hidden">
      <CoordinatorPanel presentation={coordinator} {onProviderSelected} />

      {#if isProgressPhase(controllerState)}
        <section
          class="rounded-xl border border-border bg-card p-4"
          role="status"
          data-testid="draft-progress"
        >
          <h2 class="text-sm font-semibold">{m.newWorkspace_progress_title()}</h2>
          <p class="mt-1 text-sm text-muted-foreground">{progressLabel()}</p>
          {#if presentation.progress?.clone}
            <div class="mt-3" data-clone-phase={presentation.progress.clone.phase}>
              <div class="flex justify-between gap-3 text-xs text-muted-foreground">
                <span>{presentation.progress.clone.phase}</span>
                {#if presentation.progress.clone.percent !== undefined}
                  <span>{presentation.progress.clone.percent}%</span>
                {/if}
              </div>
              {#if presentation.progress.clone.percent !== undefined}
                <progress class="mt-1 w-full" max="100" value={presentation.progress.clone.percent}
                ></progress>
              {/if}
            </div>
          {/if}
          {#if setupLabel()}
            <p
              class="mt-2 text-xs text-muted-foreground"
              data-setup-state={presentation.progress?.setup?.state}
            >
              {setupLabel()}
              {#if presentation.progress?.setup?.error}
                — {presentation.progress.setup.error}
              {/if}
            </p>
          {/if}
        </section>
      {/if}

      {#if controllerState.phase === 'failed'}
        <section class="rounded-xl border border-danger/50 bg-danger/10 p-4" role="alert">
          <div class="flex gap-2">
            <Fa icon={faTriangleExclamation} class="mt-0.5 text-danger" />
            <div>
              <h2 class="text-sm font-semibold">{m.newWorkspace_recovery_failed_title()}</h2>
              <p class="mt-1 text-sm text-muted-foreground">{controllerState.error}</p>
              {#if controllerState.retryState}
                <Button class="mt-3" size="sm" variant="outline" onclick={onRetry}>
                  {m.ui_errorToast_retry_label()}
                </Button>
              {/if}
            </div>
          </div>
        </section>
      {:else if controllerState.phase === 'offline'}
        <section class="rounded-xl border border-warning/50 bg-warning/10 p-4" role="alert">
          <h2 class="text-sm font-semibold">{m.newWorkspace_recovery_offline_title()}</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {m.newWorkspace_recovery_offline_description()}
          </p>
          <Button class="mt-3" size="sm" variant="outline" onclick={onReconnect}>
            {m.sandbox_newWorkspace_reconnect_label()}
          </Button>
        </section>
      {:else if controllerState.phase === 'conflict'}
        <section class="rounded-xl border border-warning/50 bg-warning/10 p-4" role="alert">
          <h2 class="text-sm font-semibold">{m.newWorkspace_recovery_conflict_title()}</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {m.newWorkspace_recovery_conflict_description()}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onclick={onAcceptRemote}>
              {m.newWorkspace_recovery_useRemote_label()}
            </Button>
            <Button size="sm" onclick={onKeepLocal}>
              {m.newWorkspace_recovery_keepLocal_label()}
            </Button>
          </div>
        </section>
      {/if}

      <section
        class="rounded-xl border border-border bg-background p-3"
        data-testid="draft-composer"
      >
        <RichTextarea
          value={controllerState.input.intentText}
          placeholder={m.workspace_phase_planningPlaceholder_subtitle()}
          disabled={!editorEnabled}
          repoPath={controllerState.input.source?.kind === 'local'
            ? controllerState.input.source.path
            : undefined}
          minHeight={88}
          maxHeight={220}
          onchange={(intentText) => {
            if (intentText !== controllerState.input.intentText) onEdit?.({ intentText });
          }}
          onsubmit={start}
        />

        {#if controllerState.input.attachments.length}
          <p class="mt-2 text-xs text-muted-foreground">
            {controllerState.input.attachments.length === 1
              ? m.newWorkspace_composer_attachments_one({ count: 1 })
              : m.newWorkspace_composer_attachments_many({
                  count: controllerState.input.attachments.length,
                })}
          </p>
        {/if}

        {#if showSuggestions}
          <div class="mt-3 max-h-72 overflow-auto rounded-lg border border-border p-2">
            <IssueSuggestions onSelect={appendSuggestion} initiallyExpanded />
          </div>
        {/if}

        <div
          class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"
        >
          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" disabled={!editorEnabled} onclick={onAddFiles}>
              <Fa icon={faPaperclip} />
              {m.workspace_compactInitializer_addFiles_tooltip()}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!editorEnabled}
              aria-expanded={showSuggestions}
              onclick={() => (showSuggestions = !showSuggestions)}
            >
              {m.workspace_issueSuggestions_addContext_label()}
            </Button>
          </div>
          <div class="text-right">
            {#if missingCapabilities.length}
              <p class="mb-1 text-xs text-muted-foreground">
                {m.newWorkspace_composer_prerequisites_description({
                  capabilities: missingCapabilities.join(', '),
                })}
              </p>
            {/if}
            <Button disabled={!canStart} onclick={start} data-testid="draft-start">
              {m.chat_toolClassifier_start_label()}
              <span class="opacity-50">⌘↵</span>
            </Button>
          </div>
        </div>
      </section>
    </div>
  </div>
</main>

<style>
  .new-workspace-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .shell-body {
    grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr);
  }

  .shell-body > div {
    grid-template-rows: minmax(10rem, 1fr) auto auto;
  }

  @media (max-width: 720px) {
    .new-workspace-shell {
      min-height: 52rem;
      overflow: auto;
    }

    .shell-body {
      grid-template-columns: minmax(0, 1fr);
      overflow: visible;
    }

    .shell-body > aside,
    .shell-body > div {
      overflow: visible;
    }
  }
</style>
