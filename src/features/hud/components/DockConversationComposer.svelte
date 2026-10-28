<script lang="ts" module>
  import type { Workspace } from '$shared/types';
  import type { ContextItem } from '$lib/components/chat/input/context-api';

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
  import { onDestroy, untrack } from 'svelte';
  import { getOwnedPopupContext } from '$lib/components/ui/owned-popup-context';
  import SimpleRichInput from '$lib/components/chat/input/SimpleRichInput.svelte';
  import AuroraBackground from '$lib/components/chat/AuroraBackground.svelte';
  import { COMPOSER_INSET_CLASS } from '$lib/components/chat/composer-inset';
  import { crispOut, springIn } from '$lib/motion';
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
    onValueChange,
    onContextItemsChange,
    onSubmit,
    onStop,
    onModelChange,
    onHistoryPrev,
    onHistoryNext,
  }: DockConversationComposerProps = $props();

  const popupOwner = getOwnedPopupContext();
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
  let applyingClear = false;
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
      if (disposed || editGeneration !== submitted.generation) return;
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
          generation: editGeneration,
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

  function submit(text: string, forceSubmit = false): void {
    if (disposed) return;
    const snapshot = submission(text, forceSubmit);
    snapshot.submissionId = crypto.randomUUID();
    // A late admission for an older edit generation cannot clear this draft.
    for (const [id, submitted] of submittedDrafts) {
      if (submitted.generation !== editGeneration) submittedDrafts.delete(id);
    }
    submittedDrafts.set(snapshot.submissionId, {
      generation: editGeneration,
      clearRevision,
      recoverRevision,
    });
    onSubmit(snapshot);
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
  data-dock-conversation-composer={canFocus ? '' : undefined}
  tabindex="-1"
  role="group"
  aria-label={m.chat_richInput_editor_ariaLabel()}
  onfocus={forwardFocus}
>
  {#if (popupOwner?.active() ?? true) && $chatAuroraEnabled$ && isStreaming}
    <div
      class="composer-aurora-host"
      data-testid="composer-aurora-host"
      aria-hidden="true"
      in:springIn={{ tier: 'moderate', y: 0, scale: 1 }}
      out:crispOut={{ tier: 'moderate' }}
    >
      <AuroraBackground {agentId} />
    </div>
  {/if}
  <SimpleRichInput
    bind:this={input}
    {value}
    onvaluechange={(text) => {
      if (disposed || applyingClear) return;
      editGeneration += 1;
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
    disabled={disabled || pending}
    editableWhileDisabled={pending && !disabled}
    autoFocus={false}
    panelFocused
    edgeDocked
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

<style>
  .dock-conversation-composer {
    position: relative;
    min-width: 0;
    outline: none;
  }
  .composer-aurora-host {
    position: absolute;
    inset-inline: 0;
    bottom: calc(-1 * var(--space-3));
    height: calc(100% + 10rem);
    overflow: hidden;
    pointer-events: none;
    z-index: -1;
  }
</style>
