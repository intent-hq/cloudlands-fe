<script lang="ts" module>
  import type { Workspace } from '$shared/types';
  import type { ContextItem } from '$lib/components/chat/input/context-api';
  import type { FileAttachmentPolicy } from '$lib/components/chat/input/file-attachment-policy';
  import type {
    DockEvidenceInsertion,
    DockReferenceEdit,
    DockInsertionPart,
    EditorScreenReference,
  } from '$shared/dock-evidence';
  import type { DockComposerMediaBinding } from './dock-composer-media-presentation';

  export interface DockConversationComposerSubmission {
    text: string;
    contextItems: ContextItem[];
    submissionId?: string;
    forceSubmit?: boolean;
  }

  export interface DockConversationComposerProps {
    workspace: Workspace;
    agentId: string;
    value: string;
    contextItems: ContextItem[];
    /** Advances only when the owner admits and clears this draft snapshot. */
    clearRevision?: number;
    clearSubmissionId?: string | null;
    recoverRevision?: number;
    selectedModel?: string | null;
    providerId?: string;
    isStreaming?: boolean;
    isResponding?: boolean;
    pending?: boolean;
    disabled?: boolean;
    inputLocked?: boolean;
    requiresModelSwitchConfirmation?: boolean;
    tooltipPortalTarget?: Element | string;
    media?: DockComposerMediaBinding;
    screenReferences?: readonly EditorScreenReference[];
    screenInsertions?: readonly DockEvidenceInsertion[];
    screenInterim?: readonly DockInsertionPart[];
    fileAttachmentPolicy?: FileAttachmentPolicy;
    onScreenInsertionApplied?: (id: string, committedText: string) => void;
    onCompositionChange?: (composing: boolean) => void;
    onUserTextInput?: () => void;
    /** User edits that delete or restore reference chips (not sync, insertions or clears). */
    onScreenReferencesEdited?: (edit: DockReferenceEdit) => void;
    onValueChange: (value: string) => void;
    onContextItemsChange: (items: ContextItem[]) => void;
    onSubmit: (submission: DockConversationComposerSubmission) => void;
    onStop: () => void;
    onModelChange?: (modelId: string) => void;
    onHistoryPrev?: () => string | null;
    onHistoryNext?: () => string | null;
  }
</script>

<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { notify } from '$lib/components/patterns/notify';
  import { getOwnedPopupContext } from '$lib/components/ui/owned-popup-context';
  import SimpleRichInput from '$lib/components/chat/input/SimpleRichInput.svelte';
  import DockComposerMediaFooter from './DockComposerMediaFooter.svelte';
  import DockComposerAttachments from './DockComposerAttachments.svelte';
  import AuroraBackground from '$lib/components/chat/AuroraBackground.svelte';
  import { COMPOSER_INSET_CLASS } from '$lib/components/chat/composer-inset';
  import { selectChatAuroraEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { m } from '$shared/paraglide/messages.js';

  let {
    workspace,
    agentId,
    value,
    contextItems,
    clearRevision = 0,
    clearSubmissionId = null,
    recoverRevision = 0,
    selectedModel,
    providerId,
    isStreaming = false,
    isResponding = false,
    pending = false,
    disabled = false,
    inputLocked = false,
    requiresModelSwitchConfirmation = false,
    tooltipPortalTarget,
    media,
    screenReferences,
    screenInsertions,
    screenInterim,
    fileAttachmentPolicy,
    onScreenInsertionApplied,
    onCompositionChange,
    onUserTextInput,
    onScreenReferencesEdited,
    onValueChange,
    onContextItemsChange,
    onSubmit,
    onStop,
    onModelChange,
    onHistoryPrev,
    onHistoryNext,
  }: DockConversationComposerProps = $props();

  const popupOwner = getOwnedPopupContext();
  // Mount the aurora once the composer is idle, so its WebGL setup never lands as a long
  // task when a reply starts streaming.
  let auroraWarm = $state(false);
  onMount(() => {
    const warm = () => (auroraWarm = true);
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(warm, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const timer = setTimeout(warm, 500);
    return () => clearTimeout(timer);
  });
  const chatAuroraEnabled$ = selectChatAuroraEnabled();
  let disposed = false;
  onDestroy(() => {
    disposed = true;
  });
  let root: HTMLDivElement | undefined = $state();
  let maxComposerHeight = $state(180);
  $effect(() => {
    const panel = root?.closest('[data-dock-conversation]');
    if (!panel) return;
    const resize = () => {
      maxComposerHeight = Math.max(96, Math.min(180, Math.floor(panel.clientHeight * 0.4)));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(panel);
    return () => observer.disconnect();
  });
  let input = $state<SimpleRichInput>();
  let editGeneration = 0;
  // Authorized narration insertions advance editGeneration, but are expected
  // during preparation. Only independent user edits cancel that preparation.
  let userEditGeneration = 0;
  let preparingSubmission = $state(false);
  let composing = $state(false);
  let scopeGeneration = 0;
  let previousScope: string | undefined;
  $effect(() => {
    const scope = JSON.stringify([workspace.id, agentId, workspace.ownerPrincipalId]);
    if (scope !== previousScope) {
      previousScope = scope;
      scopeGeneration += 1;
    }
  });
  let applyingClear = false;
  // Keyed by submission; `generation` is the USER edit generation at the click.
  // Programmatic edits (committed speech, chip renumbering) never block the clear.
  const submittedDrafts = new Map<
    string,
    { generation: number; clearRevision: number; recoverRevision: number }
  >();
  let clearedDraft:
    { submissionId: string; generation: number; recoverRevision: number } | undefined;
  // Keep UI staging synchronous across consecutive paste/placement callbacks.
  // Serializable parent snapshots omit File; retain it locally for upload retry.
  let stagedContextItems = $state<ContextItem[]>([]);
  $effect(() => {
    const admittedRevision = clearRevision;
    const submissionId = clearSubmissionId;
    const editor = input;
    untrack(() => {
      if (!submissionId) return;
      const submitted = submittedDrafts.get(submissionId);
      if (!editor || !submitted || admittedRevision <= submitted.clearRevision) return;
      submittedDrafts.clear();
      if (disposed || userEditGeneration !== submitted.generation) return;
      // Focused TipTap intentionally ignores value echoes. Match main chat's
      // explicit clear, including inline images, without echoing another write.
      applyingClear = true;
      try {
        editor.clear();
        stagedContextItems = [];
        clearedDraft = {
          submissionId,
          generation: editGeneration,
          recoverRevision: submitted.recoverRevision,
        };
      } finally {
        applyingClear = false;
      }
    });
  });
  $effect(() => {
    const recoveredRevision = recoverRevision;
    const submissionId = clearSubmissionId;
    const restoredValue = value;
    const editor = input;
    untrack(() => {
      const cleared = clearedDraft;
      if (!editor || !cleared || recoveredRevision <= cleared.recoverRevision) return;
      clearedDraft = undefined;
      if (
        disposed ||
        submissionId !== cleared.submissionId ||
        editGeneration !== cleared.generation
      )
        return;
      // The shared setContent transaction is synchronous and does not move focus.
      // Suppress its immediate echoes, never subsequent user input.
      applyingClear = true;
      try {
        void editor.setContent(restoredValue);
        // An unchanged recovered draft can be cleared by canonical Retry or
        // later accepted evidence using the same submission identity.
        submittedDrafts.set(cleared.submissionId, {
          generation: userEditGeneration,
          clearRevision,
          recoverRevision: recoveredRevision,
        });
      } finally {
        applyingClear = false;
      }
    });
  });
  $effect(() => {
    const incoming = contextItems;
    const stagedFiles = new Map(
      untrack(() => stagedContextItems).map((item) => [item.id, item.file]),
    );
    stagedContextItems = incoming.map((item) => {
      const file = item.file ?? stagedFiles.get(item.id);
      return file ? { ...item, file } : item;
    });
  });
  function changeContextItems(items: ContextItem[]): void {
    if (disposed || applyingClear) return;
    editGeneration += 1;
    userEditGeneration += 1;
    stagedContextItems = items;
    onContextItemsChange(items);
  }
  const canFocus = $derived(!disabled && !inputLocked);

  // Only gather editor-owned context here. The connected owner freezes identity,
  // persists the complete draft and runs the canonical send/queue lifecycle.
  function submission(text: string, forceSubmit = false): DockConversationComposerSubmission {
    const items = [
      ...stagedContextItems,
      ...(input?.getInlineImageContextItems() ?? []),
      ...(input?.getMentionContextItems() ?? []),
    ].map((item) => {
      const snapshot = { ...item };
      // Shared placement/paste already preserves bytes or an attachment reference.
      // Browser File instances must not enter the connected action boundary.
      delete snapshot.file;
      return snapshot;
    });
    return { text, contextItems: items, ...(forceSubmit ? { forceSubmit: true } : {}) };
  }

  function commitSubmission(text: string, forceSubmit = false): void {
    if (disposed) return;
    const snapshot = submission(text, forceSubmit);
    snapshot.submissionId = crypto.randomUUID();
    // A late admission cannot clear a draft the user edited after an older click.
    for (const [id, submitted] of submittedDrafts) {
      if (submitted.generation !== userEditGeneration) submittedDrafts.delete(id);
    }
    submittedDrafts.set(snapshot.submissionId, {
      generation: userEditGeneration,
      clearRevision,
      recoverRevision,
    });
    onSubmit(snapshot);
  }

  function submit(text: string, forceSubmit = false): void {
    if (disposed || preparingSubmission || (media && composing)) return;
    const beforeSubmit = media?.beforeSubmit;
    if (!beforeSubmit) {
      commitSubmission(text, forceSubmit);
      return;
    }
    void prepareSubmission(beforeSubmit, forceSubmit);
  }

  async function prepareSubmission(
    beforeSubmit: () => Promise<boolean>,
    forceSubmit: boolean,
  ): Promise<void> {
    const workspaceId = workspace.id;
    const ownerPrincipalId = workspace.ownerPrincipalId;
    const submittedAgentId = agentId;
    const generation = userEditGeneration;
    const scope = scopeGeneration;
    const initialClearRevision = clearRevision;
    const initialRecoverRevision = recoverRevision;
    const isCurrent = () =>
      !disposed &&
      workspace.id === workspaceId &&
      workspace.ownerPrincipalId === ownerPrincipalId &&
      agentId === submittedAgentId &&
      scopeGeneration === scope &&
      userEditGeneration === generation &&
      clearRevision === initialClearRevision &&
      recoverRevision === initialRecoverRevision;
    preparingSubmission = true;
    try {
      if (!(await beforeSubmit())) return;
      await tick();
      if (!isCurrent() || composing || disabled || inputLocked || pending) return;
      // The barrier may have committed final speech and mark chips. Freeze their
      // acknowledged text as the editor holds it now (the `value` prop can lag a
      // store notification), never the pre-barrier string from the original click.
      commitSubmission(input?.getValue() ?? value, forceSubmit);
    } catch {
      if (isCurrent()) notify.error(m.dock_conversation_sendFailed_error());
    } finally {
      preparingSubmission = false;
    }
  }

  export function flushScreenEvidence(): boolean {
    return !disposed && !composing && (input?.flushScreenEvidence() ?? false);
  }

  function removeMediaAttachment(id: string): void {
    const item = media?.attachments.find((candidate) => candidate.id === id);
    if (!item || disposed || disabled || pending || inputLocked || preparingSubmission) return;
    if (item.owner === 'attachment') input?.removeAttachment(id);
    else media?.onRemove(id);
  }

  function retryMediaAttachment(id: string): void {
    const item = media?.attachments.find((candidate) => candidate.id === id);
    if (!item || disposed || disabled || pending || inputLocked || preparingSubmission) return;
    if (item.owner === 'attachment') void input?.retryAttachment(id);
    else media?.onRetry?.(id);
  }

  export function focus(): Promise<boolean> {
    if (disposed || !canFocus || !input) return Promise.resolve(false);
    return input.focus();
  }

  function forwardFocus(event: FocusEvent): void {
    if (event.target === event.currentTarget) void focus();
  }
</script>

<div
  bind:this={root}
  class="dock-conversation-composer"
  data-dock-media={media ? '' : undefined}
  data-dock-conversation-composer={canFocus ? '' : undefined}
  tabindex="-1"
  role="group"
  aria-label={m.chat_richInput_editor_ariaLabel()}
  onfocus={forwardFocus}
>
  {#if (popupOwner?.active() ?? true) && $chatAuroraEnabled$ && (isStreaming || auroraWarm)}
    <!-- Warmed paused while idle; streaming only unpauses and fades it (no mount cost). -->
    <div
      class="composer-aurora-host"
      data-testid={isStreaming ? 'composer-aurora-host' : undefined}
      data-streaming={isStreaming || undefined}
      aria-hidden="true"
    >
      <AuroraBackground {agentId} paused={!isStreaming} />
    </div>
  {/if}
  <SimpleRichInput
    bind:this={input}
    {value}
    placeholder={media?.placeholder}
    reactivePlaceholder
    sendDisabledTooltip={media ? m.dock_composer_sendDisabled_tooltip() : undefined}
    {screenReferences}
    {screenInsertions}
    {screenInterim}
    screenSpeechActive={!!media?.state.dictating}
    pendingContent={!!media?.state.dictating || (screenInterim?.length ?? 0) > 0}
    submitPending={preparingSubmission}
    {fileAttachmentPolicy}
    deferScreenEvidenceFlush={!!media?.beforeSubmit}
    onScreenInsertionApplied={(id, committedText) => {
      if (disposed || applyingClear) return;
      editGeneration += 1;
      // The connected owner commits the draft and consumes this insertion once.
      // Also calling onValueChange here would create a second draft transaction.
      onScreenInsertionApplied?.(id, committedText);
    }}
    onCompositionChange={(isComposing) => {
      if (disposed) return;
      composing = isComposing;
      if (isComposing) userEditGeneration += 1;
      onCompositionChange?.(isComposing);
    }}
    onUserTextInput={() => {
      if (!disposed && !applyingClear) onUserTextInput?.();
    }}
    onScreenReferencesEdited={(edit) => {
      if (!disposed && !applyingClear) onScreenReferencesEdited?.(edit);
    }}
    composerActions={media ? mediaActions : undefined}
    renderAttachments={media ? mediaAttachments : undefined}
    onvaluechange={(text, change) => {
      if (disposed || applyingClear) return;
      editGeneration += 1;
      // Chip renumbering after evidence changes is not the user's edit.
      if (!change?.programmatic) userEditGeneration += 1;
      onValueChange(text);
    }}
    bind:contextItems={() => stagedContextItems, changeContextItems}
    {workspace}
    {agentId}
    {selectedModel}
    {providerId}
    {isStreaming}
    {isResponding}
    {requiresModelSwitchConfirmation}
    {inputLocked}
    disabled={disabled || pending || preparingSubmission || (!!media && composing)}
    editableWhileDisabled={(pending || preparingSubmission || (!!media && composing)) && !disabled}
    autoFocus={false}
    panelFocused
    edgeDocked
    announceAddedImages={false}
    compactMode
    {maxComposerHeight}
    editorClassName={`${COMPOSER_INSET_CLASS} w-full`}
    contentInsetClassName={`${COMPOSER_INSET_CLASS} w-full`}
    actionBarEndClassName={COMPOSER_INSET_CLASS}
    tooltipPortalTarget={tooltipPortalTarget ?? popupOwner?.target()}
    onsubmit={(text) => submit(text)}
    onforcesubmit={(text) => submit(text, true)}
    onstop={() => {
      if (!disposed) onStop();
    }}
    onmodelChange={(model) => {
      if (!disposed) onModelChange?.(model);
    }}
    onHistoryPrev={() => (disposed ? null : (onHistoryPrev?.() ?? null))}
    onHistoryNext={() => (disposed ? null : (onHistoryNext?.() ?? null))}
  />
</div>

{#snippet mediaActions()}
  {#if media}
    <DockComposerMediaFooter
      {...media}
      disabled={disabled || pending || inputLocked || preparingSubmission}
    />
  {/if}
{/snippet}

{#snippet mediaAttachments()}
  {#if media}
    <!-- Same inline inset as the editor and action bar: one left and right edge. -->
    <div class={`${COMPOSER_INSET_CLASS} min-w-0`} data-dock-media-attachments-inset>
      <DockComposerAttachments
        items={media.attachments}
        labels={media.labels}
        disabled={disabled || pending || inputLocked || preparingSubmission}
        onMarkUp={media.onMarkUp}
        onRemove={removeMediaAttachment}
        onRetry={retryMediaAttachment}
      />
    </div>
  {/if}
{/snippet}

<style>
  .dock-conversation-composer {
    min-width: 0;
    outline: none;
  }
  .dock-conversation-composer[data-dock-media] :global([data-chat-input-submit-actions]) {
    flex: 1 0 auto;
    min-width: min-content;
  }
  .dock-conversation-composer[data-dock-media] :global([data-chat-input-primary-actions]) {
    flex: 0 1 110px;
    min-width: 24px;
  }
  /* The picker glyph sits on the editor text edge; its hover fill bleeds outward.
     The negative margin equals the trigger's inline padding (px-2). */
  .dock-conversation-composer[data-dock-media] :global([data-chat-input-primary-actions] button) {
    max-width: calc(100% + 0.5rem);
    min-width: 0;
    left: 0;
    margin-inline-start: -0.5rem;
  }
  .dock-conversation-composer[data-dock-media] :global([data-chat-input-action-bar]) {
    gap: 4px;
  }
  /* Spec card radius 16. Send hugs the bottom-right corner 6px from the card edges with a
     concentric radius (16 - 6); the footer row centers on it, so the space below shrinks. */
  .dock-conversation-composer[data-dock-media] :global([data-testid='message-input']) {
    border-radius: 16px;
    padding-bottom: 6px;
  }
  .dock-conversation-composer[data-dock-media] :global([data-testid='composer-submit-button']) {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    /* The action bar keeps the 8px text inset; only Send moves 2px into the corner. */
    margin-inline-end: -2px;
  }
  /* Empty Send: a quiet control fill (#2A2A2A, dark surface-4) and subtle arrow,
     never a dimmed accent. Text or an attachment restores the citrus fill. */
  .dock-conversation-composer[data-dock-media]
    :global([data-testid='composer-submit-button'][data-mode='send']:disabled) {
    opacity: 1;
    color: hsl(var(--muted-foreground) / 0.6);
  }
  .dock-conversation-composer[data-dock-media]
    :global(
      [data-testid='composer-submit-button'][data-mode='send']:disabled [data-slot='button-surface']
    ) {
    background: hsl(var(--surface-4));
    box-shadow: none;
  }
  /* The glow spans the conversation card's full width and bottom edge. Its containing
     block is the question composer inside the composer lane, so reach back out through
     the lane's inline and bottom inset (0 in the chief lane). */
  .composer-aurora-host {
    position: absolute;
    inset-inline: calc(-1 * var(--chat-content-inset, 0px));
    bottom: calc(-1 * var(--chat-content-inset, 0px));
    height: calc(100% + 10rem);
    overflow: hidden;
    pointer-events: none;
    z-index: -1;
    opacity: 0;
    /* A soft glow: the slow tier keeps each frame's change small, even across a dropped frame. */
    transition: opacity var(--spring-slow) var(--spring-slow-ease);
  }
  /* The glow starts one beat after the stream: its fade runs after the busy first frame of
     streaming UI, so no frame of it is skipped. Fading out is immediate. */
  .composer-aurora-host[data-streaming] {
    opacity: 1;
    transition-delay: var(--spring-fast);
  }
  @container style(--motion-reduced: 1) {
    .composer-aurora-host {
      transition: none;
    }
  }
</style>
