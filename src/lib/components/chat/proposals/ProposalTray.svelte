<!--
  Composer-slot pending-proposal tray: walks the daemon's ordered pending
  proposals (PROTOCOL §5.5) one at a time, reusing ProposalCard as the body.
  "n of N" header with back/forward chevrons when N > 1; Hide collapses to a
  compact re-expandable banner (the host owns the collapse flag and its
  persistence, like the Q&A wizard); Dismiss (header button or the card's
  own Discard, suppressed locally) is gated behind a confirmation dialog and
  hands off to `onDismiss` — the host dispatches resolve(dismissed). Apply
  forwards to `onApply` — the host dispatches the kind-specific apply action
  and, on lifecycle success, resolve(applied); the resolved entry then drops
  out of `entries` and the clamped index advances to the next proposal.
  The last-viewed proposal and per-proposal transient card edits persist to
  localStorage per agent (proposal-tray-storage) and restore on
  remount/reload; the host clears drafts when a proposal resolves. Inline
  only — no pop-outs — and narrow-first (min-w-0, works down to ~300px).
  The body is a vertical scroll region capped by the host-supplied
  maxBodyHeight (derived from the chat panel's measured height), with the
  header outside the scroll region, so a tall card in a short/narrow panel
  (the Chief sidebar) never pushes its own actions or the composer out of
  reach.
-->
<script module lang="ts">
  /**
   * Cap for the scrollable tray body, derived from the host chat panel's
   * measured height: reserve room for the panel chrome around the tray
   * (transcript sliver, tray header, composer input — ~240px) and never
   * exceed 480px so tall panels keep the transcript dominant. In panels too
   * short for the full reserve the chrome compresses instead (the transcript
   * sliver flexes away, leaving ~140px of fixed chrome — tray header +
   * composer), so the body target becomes panelHeight - 140 up to a 160px
   * comfort ceiling, with a hard 96px floor so the card stays a usable
   * scroll region. 0 (unmeasured host) falls back to the cap.
   */
  export function trayBodyMaxHeight(panelHeight: number): number {
    if (panelHeight <= 0) return 480;
    const shortPanelBody = Math.min(160, panelHeight - 140);
    return Math.max(96, Math.min(Math.max(panelHeight - 240, shortPanelBody), 480));
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import type { ProposalActionDetail } from '$shared/types/proposal';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import ProposalCard from './ProposalCard.svelte';
  import DismissProposalConfirmDialog from './DismissProposalConfirmDialog.svelte';
  import type { PendingProposalEntry } from './pending-proposals';
  import {
    loadTrayDraft,
    loadTrayPosition,
    saveTrayDraft,
    saveTrayPosition,
    type ProposalCardDraft,
  } from './proposal-tray-storage';

  interface Props {
    /** Storage namespace — the host remounts the tray per agent ({#key}). */
    agentId: string;
    /** Ordered pending entries (deriveTrayPendingProposals), never empty. */
    entries: PendingProposalEntry[];
    /** Host-owned Hide state — true renders the compact banner. */
    collapsed?: boolean;
    onToggleCollapsed?: (collapsed: boolean) => void;
    /** Apply forwarding — host dispatches the kind-specific apply action. */
    onApply?: (detail: ProposalActionDetail) => void;
    /**
     * Persistent dismissal — host dispatches resolve(dismissed). May return
     * a promise; a rejected dismissal (host toasts) keeps the entry pending.
     */
    onDismiss?: (entry: PendingProposalEntry) => Promise<void> | void;
    onUndo?: (proposalId: string) => void;
    /** Pixel cap for the scrollable body (trayBodyMaxHeight of the host). */
    maxBodyHeight?: number;
  }

  let {
    agentId,
    entries,
    collapsed = false,
    onToggleCollapsed,
    onApply,
    onDismiss,
    onUndo,
    maxBodyHeight = 480,
  }: Props = $props();

  // The host remounts the tray per agent ({#key agentId}), so the storage
  // namespace is immutable per instance. Captured once at init so
  // teardown-time reads never re-evaluate the prop getter.
  // svelte-ignore state_referenced_locally
  const storageAgentId = agentId;

  // Restore the last-viewed proposal before the index state initializes.
  // Intentional initial capture — later entry-set changes clamp below.
  // svelte-ignore state_referenced_locally
  const restoredIdx = (() => {
    const restoredId = loadTrayPosition(storageAgentId);
    if (!restoredId) return 0;
    // svelte-ignore state_referenced_locally
    const found = entries.findIndex((entry) => entry.proposalId === restoredId);
    return found >= 0 ? found : 0;
  })();

  let idx = $state(restoredIdx);
  // Dismiss is destructive and persistent — gate it behind a confirm dialog.
  let confirmingDismiss = $state(false);

  // Entries shrink as proposals resolve: clamping (not resetting) makes the
  // tray advance naturally to the entry now occupying the same position.
  const clampedIdx = $derived(Math.max(0, Math.min(idx, entries.length - 1)));
  const current = $derived(entries[clampedIdx] as PendingProposalEntry | undefined);
  const multiStep = $derived(entries.length > 1);

  $effect(() => {
    if (current) saveTrayPosition(storageAgentId, current.proposalId);
  });

  // ── Per-proposal transient-edit draft persistence ───────────────────────
  // ProposalCard reports every transient edit (onDraftChange); saves are
  // debounced so typing does not write every keystroke, and the pending save
  // is flushed on unmount so switching away mid-typing loses nothing. The
  // host clears the stored draft when the proposal resolves.
  const DRAFT_SAVE_DEBOUNCE_MS = 300;
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingDraftSave: { proposalId: string; draft: ProposalCardDraft } | null = null;

  function flushPendingDraftSave() {
    if (draftSaveTimer !== null) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }
    if (pendingDraftSave) {
      saveTrayDraft(storageAgentId, pendingDraftSave.proposalId, pendingDraftSave.draft);
      pendingDraftSave = null;
    }
  }

  function handleDraftChange(proposalId: string, draft: ProposalCardDraft) {
    pendingDraftSave = { proposalId, draft };
    if (draftSaveTimer !== null) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      draftSaveTimer = null;
      if (pendingDraftSave) {
        saveTrayDraft(storageAgentId, pendingDraftSave.proposalId, pendingDraftSave.draft);
        pendingDraftSave = null;
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);
  }

  onDestroy(flushPendingDraftSave);

  function handleBack() {
    idx = Math.max(clampedIdx - 1, 0);
  }

  function handleForward() {
    idx = Math.min(clampedIdx + 1, entries.length - 1);
  }
</script>

<div
  class="min-w-0 overflow-hidden rounded-(--radius-large) border-0 bg-card"
  data-proposal-tray
  data-testid="proposal-tray-card"
>
  {#if collapsed}
    <!-- Hide-collapsed banner: click to re-expand (mirrors the Q&A wizard). -->
    <Button
      variant="ghost"
      class="h-auto min-w-0 w-full justify-start gap-2 rounded-none border-transparent px-3 py-2.5 text-left font-normal whitespace-normal hover:border-transparent hover:bg-accent sm:px-4"
      data-testid="proposal-tray-banner"
      onclick={() => onToggleCollapsed?.(false)}
    >
      <span class="type-caption font-medium text-foreground">{m.chat_proposalTray_title()}</span>
      <span class="type-caption text-subtle">{entries.length}</span>
      <span class="ml-auto min-w-0 truncate type-caption text-subtle"
        >{m.chat_proposalTray_clickToExpand_label()}</span
      >
    </Button>
  {:else if current}
    <div
      class="flex min-h-7 min-w-0 items-center gap-2 px-3 pt-3 sm:px-4"
      data-proposal-tray-header
    >
      {#if multiStep}
        <span class="flex shrink-0 items-center gap-1" data-proposal-tray-nav>
          <Button
            variant="ghost"
            size="icon-xs"
            class="size-auto rounded-(--radius-small) p-1 text-subtle hover:border-transparent hover:bg-accent hover:text-foreground"
            aria-label={m.chat_proposalTray_back_ariaLabel()}
            data-testid="proposal-tray-back"
            disabled={clampedIdx === 0}
            onclick={handleBack}
          >
            <Fa icon={faChevronLeft} class="text-[9px] a11y-ignore" />
          </Button>
          <span class="type-caption text-subtle" data-proposal-step-counter
            >{m.chat_proposalTray_stepCounter_label({
              current: clampedIdx + 1,
              total: entries.length,
            })}</span
          >
          <Button
            variant="ghost"
            size="icon-xs"
            class="size-auto rounded-(--radius-small) p-1 text-subtle hover:border-transparent hover:bg-accent hover:text-foreground"
            aria-label={m.chat_proposalTray_forward_ariaLabel()}
            data-testid="proposal-tray-forward"
            disabled={clampedIdx === entries.length - 1}
            onclick={handleForward}
          >
            <Fa icon={faChevronRight} class="text-[9px] a11y-ignore" />
          </Button>
        </span>
      {/if}
      <p class="min-w-0 flex-1 truncate type-caption text-subtle" data-proposal-header-title>
        {current.proposal.preview.title}
      </p>
      <span class="flex shrink-0 items-center gap-1" data-proposal-header-actions>
        <Button
          variant="ghost"
          class="h-auto rounded-(--radius-small) px-1.5 py-1 type-caption font-normal text-subtle hover:border-transparent hover:bg-accent hover:text-foreground"
          title={m.chat_proposalTray_hide_tooltip()}
          onclick={() => onToggleCollapsed?.(true)}
        >
          {m.chat_proposalTray_hide_label()}
        </Button>
        {#if onDismiss}
          <Button
            variant="ghost"
            class="h-auto rounded-(--radius-small) px-1.5 py-1 type-caption font-normal text-error-foreground hover:border-transparent hover:bg-destructive hover:text-destructive-foreground"
            title={m.chat_proposalTray_dismiss_tooltip()}
            onclick={() => (confirmingDismiss = true)}
          >
            {m.chat_proposalTray_dismiss_label()}
          </Button>
        {/if}
      </span>
    </div>

    {#key current.proposalId}
      <div
        class="min-w-0 overflow-y-auto overscroll-contain px-3 pb-1 sm:px-4"
        style:max-height="{maxBodyHeight}px"
        data-proposal-tray-body
      >
        <ProposalCard
          proposal={current.proposal}
          suppressLocalDiscard
          initialDraft={loadTrayDraft(storageAgentId, current.proposalId)}
          onDraftChange={(draft) => handleDraftChange(current.proposalId, draft)}
          {onApply}
          onDiscard={() => (confirmingDismiss = true)}
          {onUndo}
        />
      </div>
    {/key}
  {/if}
</div>

<DismissProposalConfirmDialog
  open={confirmingDismiss}
  onConfirm={async () => {
    confirmingDismiss = false;
    const entry = current;
    if (!entry) return;
    // A pending edit draft may still be in the debounce window; flush it so
    // a FAILED dismissal (entry stays pending) keeps the edits on remount.
    flushPendingDraftSave();
    try {
      await onDismiss?.(entry);
    } catch {
      // Host surfaces the failure; the entry stays pending with its draft.
    }
  }}
  onCancel={() => (confirmingDismiss = false)}
/>
