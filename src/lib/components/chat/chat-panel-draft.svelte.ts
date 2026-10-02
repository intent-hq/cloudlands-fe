/**
 * ChatPanel composer draft restore/save manager (PROTOCOL §5.16 `drafts.*`).
 *
 * Extracted from ChatPanel.svelte's draft $effect blocks so the restore/save
 * lifecycle is unit-testable with a mounted harness component. Must be
 * created during component initialization (uses `$effect`).
 *
 * User typing is authoritative: a restore never overwrites a non-empty
 * composer (text or attachments), and the deferred editor-hydration callback
 * re-checks the current value before applying. While a restore is in flight
 * the composer is gated (`gateActive`) so a mount-time empty save cannot
 * erase the persisted draft; a fallback releases the gate after 5s if the
 * daemon doesn't answer. The gate's loading indicator is deferred behind
 * `gateVisible` delay so a fast restore never blinks a spinner.
 *
 * The restore re-runs whenever the `(workspaceId, agentId)` pair changes:
 * the composer resets, dirty-tracking resets, and a late-resolving restore
 * for a previous pair is discarded. A debounced save still pending at a pair
 * change or unmount is flushed (persisting the final keystrokes); all other
 * timers are torn down so no editor writes fire after destroy.
 * `invalidatePendingRestore()` discards an in-flight restore for the current
 * pair without rebinding it — the send path calls it after clearing the
 * composer so a stale `drafts.get` response cannot repopulate the just-sent
 * prompt.
 *
 * Transport, the save debounce, and `drafts.set`/`drafts.clear` ordering are
 * owned by the chat-drafts saga: the manager dispatches correlated requests
 * and applies their outcomes from `selectChatDraftOwnerView`, keyed by a
 * per-instance owner id so concurrent panels never settle each other.
 *
 * A process-lifetime `chat-draft-cache` (per `(workspaceId, agentId)`) makes
 * switch-back instant: a cache hit hydrates the composer synchronously with
 * no gate, then `drafts.get` still runs in the background to revalidate and
 * refresh the cache — applying its result to the composer only if the user
 * hasn't typed since the cache hydrated it. A cache miss (first-ever visit
 * to the pair) keeps the original gated restore below.
 */
import { untrack } from 'svelte';
import type { Readable } from 'svelte/store';

import { store as appStore } from '$store/renderer/store';
import {
  chatDraftOwnerOpened,
  chatDraftOwnerReleased,
  chatDraftRestoreInvalidated,
  chatDraftRestoreRequested,
  chatDraftSaveCancelled,
  chatDraftSaveFlushRequested,
  chatDraftSaveOutcomesAcknowledged,
  chatDraftSaveScheduled,
} from '$store/renderer/slices/chat-drafts/chat-drafts-slice';
import { selectChatDraftOwnerView } from '$store/renderer/slices/chat-drafts/chat-drafts-selectors';
import type {
  ChatDraftOwnerView,
  ChatDraftRestore,
  ChatDraftSaveOutcome,
} from '$store/renderer/slices/chat-drafts/chat-drafts-types';
import { getCachedDraft, setCachedDraft } from './chat-draft-cache';
import { serializeDraftAttachments, deserializeDraftAttachments } from './chat-draft-attachments';
import type { ContextItem } from './input/context-api';

type ChatDraftAction = ReturnType<
  | typeof chatDraftOwnerOpened
  | typeof chatDraftOwnerReleased
  | typeof chatDraftRestoreRequested
  | typeof chatDraftRestoreInvalidated
  | typeof chatDraftSaveScheduled
  | typeof chatDraftSaveFlushRequested
  | typeof chatDraftSaveCancelled
  | typeof chatDraftSaveOutcomesAcknowledged
>;

/** Store seam: the app store by default; tests inject a saga-backed store. */
export interface ChatDraftStorePort {
  dispatch: (action: ChatDraftAction) => unknown;
  ownerView: (ownerId: string) => Readable<ChatDraftOwnerView | undefined>;
}

export interface ChatDraftManagerOptions {
  store?: ChatDraftStorePort;
  workspaceId: () => string | undefined;
  agentId: () => string | undefined;
  active?: () => boolean;
  inputValue: () => string;
  setInputValue: (text: string) => void;
  contextItems: () => ContextItem[];
  setContextItems: (items: ContextItem[]) => void;
  /** Shared items already follow the current pair; a rebind must not clear them. */
  contextItemsAreScoped?: boolean;
  /** Push restored text into the rich input editor (e.g. setContent). */
  applyEditorContent: (text: string) => void;
  onSaveError?: (error: unknown) => void;
}

export interface ChatDraftManager {
  /** True while the initial draft restore gates the composer. */
  readonly gateActive: boolean;
  /**
   * True once a gated restore has been in flight for `GATE_VISIBLE_DELAY_MS` —
   * drives the loading indicator so a fast restore renders no spinner at all.
   */
  readonly gateVisible: boolean;
  /**
   * Discard any in-flight restore/revalidation for the current pair and
   * release the gate, without touching the composer. Call when the empty
   * composer takes ownership (a send just cleared it and `drafts.clear` was
   * issued) so a stale `drafts.get` response cannot restore the just-sent
   * prompt into the editor. Also drops a pending debounced save of the
   * pre-send text and resets the pair's switch-back cache entry and
   * dirty-tracking to the cleared state, so neither a flush-at-unmount nor a
   * reopen can resurrect the sent prompt.
   *
   * Caller contract: the caller owns the composer state after this call — it
   * must clear the editor itself and persist/clear the daemon-side draft on
   * its own (ChatPanel's send cleanup empties the composer and dispatches
   * `chatDraftClearRequested`). The manager only stops competing with that
   * ownership.
   */
  invalidatePendingRestore(): void;
}

/** Delay before pushing restored text into the editor (lets it mount). */
const HYDRATE_DELAY_MS = 50;
/** Fallback: release the composer gate if `drafts.get` hasn't settled. */
const GATE_TIMEOUT_MS = 5000;
/** Delay before the gate becomes visible as a loading indicator. */
const GATE_VISIBLE_DELAY_MS = 500;

const appStorePort = (): ChatDraftStorePort => ({
  dispatch: (action) => appStore.dispatch(action),
  ownerView: (ownerId) => selectChatDraftOwnerView(ownerId),
});

export function createChatDraftManager(options: ChatDraftManagerOptions): ChatDraftManager {
  const port = options.store ?? appStorePort();
  const ownerId = crypto.randomUUID();
  let gateActive = $state(false);
  let gateVisible = $state(false);
  // Last state known to match the daemon's copy (restored or saved). Null
  // until the restore settles — while unknown, empty saves are suppressed so
  // a fresh mount can never erase a persisted draft.
  let lastPersisted: { text: string; attachmentsJson: string } | null = null;
  // (workspaceId, agentId) pair whose restore is current (in flight or done).
  let restoreKey: string | null = null;
  // Bumped per restore run and by invalidatePendingRestore(): async restore
  // continuations from a superseded generation are discarded.
  let restoreGeneration = 0;
  let destroyed = false;
  let gateTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let gateVisibleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let hydrateTimeoutId: ReturnType<typeof setTimeout> | null = null;
  // Bumped by invalidatePendingRestore(): a save committed before the send
  // must not re-mark its pre-send text as persisted.
  let invalidations = 0;
  // Debounced save scheduled with the saga; flushed on pair change and
  // unmount so the last keystrokes are persisted instead of dropped.
  let pendingSaveRequestId: string | null = null;
  let pendingRestore: { requestId: string; apply: (restore: ChatDraftRestore) => void } | null =
    null;
  const saveHandlers: Record<string, (outcome: ChatDraftSaveOutcome) => void> = {};
  let latestView: ChatDraftOwnerView | undefined;

  const applyOutcomes = (view: ChatDraftOwnerView | undefined) => {
    latestView = view;
    if (!view || destroyed) return;
    const restore = view.restore;
    if (pendingRestore && restore?.requestId === pendingRestore.requestId) {
      if (restore.status !== 'pending') {
        const { apply } = pendingRestore;
        pendingRestore = null;
        apply(restore);
      }
    }
    const acknowledged: string[] = [];
    for (const save of view.saves) {
      if (save.status === 'pending') continue;
      acknowledged.push(save.id);
      const handler = saveHandlers[save.id];
      delete saveHandlers[save.id];
      handler?.(save);
    }
    if (acknowledged.length > 0) {
      queueMicrotask(() => port.dispatch(chatDraftSaveOutcomesAcknowledged(ownerId, acknowledged)));
    }
  };

  const requestRestore = (
    workspaceId: string,
    agentId: string,
    apply: (restore: ChatDraftRestore) => void,
  ) => {
    const requestId = crypto.randomUUID();
    pendingRestore = { requestId, apply };
    port.dispatch(chatDraftRestoreRequested(ownerId, requestId, workspaceId, agentId));
  };

  const dropRestore = () => {
    if (!pendingRestore) return;
    pendingRestore = null;
    port.dispatch(chatDraftRestoreInvalidated(ownerId));
  };

  const cancelPendingSave = () => {
    const requestId = pendingSaveRequestId;
    if (!requestId) return;
    pendingSaveRequestId = null;
    port.dispatch(chatDraftSaveCancelled(ownerId));
    // A save the saga already committed keeps its handler for the outcome.
    if (!latestView?.saves.some((save) => save.id === requestId)) delete saveHandlers[requestId];
  };

  port.dispatch(chatDraftOwnerOpened(ownerId));
  const unsubscribe = port
    .ownerView(ownerId)
    .subscribe((view) => untrack(() => applyOutcomes(view)));

  const clearGateVisible = () => {
    if (gateVisibleTimeoutId) {
      clearTimeout(gateVisibleTimeoutId);
      gateVisibleTimeoutId = null;
    }
    gateVisible = false;
  };

  const flushPendingSave = () => {
    if (!pendingSaveRequestId) return;
    pendingSaveRequestId = null;
    port.dispatch(chatDraftSaveFlushRequested(ownerId));
  };

  // Restore draft from backend on mount and on (workspaceId, agentId) change
  $effect(() => {
    const active = options.active?.() ?? true;
    const workspaceId = options.workspaceId();
    const agentId = options.agentId();
    if (!active) {
      untrack(() => {
        restoreGeneration += 1;
        restoreKey = null;
        dropRestore();
        if (gateTimeoutId) clearTimeout(gateTimeoutId);
        gateTimeoutId = null;
        clearGateVisible();
        if (hydrateTimeoutId) clearTimeout(hydrateTimeoutId);
        hydrateTimeoutId = null;
        gateActive = false;
        flushPendingSave();
      });
      return;
    }
    if (!workspaceId || !agentId) return;
    const key = `${workspaceId}\u0000${agentId}`;
    if (restoreKey === key) return;
    const isPairChange = restoreKey !== null;
    restoreKey = key;
    const generation = ++restoreGeneration;

    untrack(() => {
      // A previous pair's restore/hydration no longer applies.
      lastPersisted = null;
      if (gateTimeoutId) clearTimeout(gateTimeoutId);
      clearGateVisible();
      if (hydrateTimeoutId) {
        clearTimeout(hydrateTimeoutId);
        hydrateTimeoutId = null;
      }
      if (isPairChange) {
        // Persist any not-yet-debounced typing under the previous pair, then
        // reset the composer — its content belongs to the old pair.
        flushPendingSave();
        options.setInputValue('');
        if (!options.contextItemsAreScoped) options.setContextItems([]);
        options.applyEditorContent('');
      }

      const cached = getCachedDraft(workspaceId, agentId);
      if (cached) {
        // Cache hit: hydrate synchronously, no gate — switch-back to a
        // previously visited pair never shows the loading indicator,
        // regardless of the background revalidation's latency.
        gateActive = false;
        const hasLiveAttachments = options.contextItems().length > 0;
        const hydratedText = cached.text;
        const hydratedAttachmentsJson = JSON.stringify(cached.attachments);
        options.setInputValue(cached.text);
        if (!hasLiveAttachments) {
          options.setContextItems(deserializeDraftAttachments(cached.attachments));
        }
        options.applyEditorContent(cached.text);
        lastPersisted = { text: cached.text, attachmentsJson: hydratedAttachmentsJson };

        requestRestore(workspaceId, agentId, (restore) => {
          // Keep the cached hydration on failure — nothing to release since
          // the cache-hit path never gates the composer.
          if (restore.status !== 'restored') return;
          const draft = restore.draft;
          // Discard late revalidations after unmount, a pair change, or an
          // invalidation (the composer's current state won the race).
          if (
            destroyed ||
            !(options.active?.() ?? true) ||
            restoreKey !== key ||
            restoreGeneration !== generation
          )
            return;
          const freshText = draft?.text ?? '';
          const freshAttachments = draft?.attachments ?? [];
          const freshAttachmentsJson = JSON.stringify(freshAttachments);
          setCachedDraft(workspaceId, agentId, {
            text: freshText,
            attachments: freshAttachments,
          });

          // User typing is authoritative — only apply the revalidated
          // result if the composer still matches what the cache hydrated.
          const untouched =
            options.inputValue() === hydratedText &&
            JSON.stringify(serializeDraftAttachments(options.contextItems())) ===
              hydratedAttachmentsJson;
          if (hasLiveAttachments || !untouched) return;
          if (freshText !== hydratedText) {
            options.setInputValue(freshText);
            options.applyEditorContent(freshText);
          }
          if (freshAttachmentsJson !== hydratedAttachmentsJson) {
            options.setContextItems(deserializeDraftAttachments(freshAttachments));
          }
          lastPersisted = { text: freshText, attachmentsJson: freshAttachmentsJson };
        });
        return;
      }

      // Cache miss (first-ever visit to this pair): gated restore, unchanged.
      gateActive = true;
      // The spinner only earns its place once the restore is visibly slow.
      gateVisibleTimeoutId = setTimeout(() => {
        gateVisibleTimeoutId = null;
        if (!(options.active?.() ?? true)) return;
        gateVisible = true;
      }, GATE_VISIBLE_DELAY_MS);
      gateTimeoutId = setTimeout(() => {
        if (!(options.active?.() ?? true)) return;
        gateActive = false;
        clearGateVisible();
      }, GATE_TIMEOUT_MS);
      const release = () => {
        if (!(options.active?.() ?? true) || restoreKey !== key || restoreGeneration !== generation)
          return;
        if (gateTimeoutId) clearTimeout(gateTimeoutId);
        gateActive = false;
        clearGateVisible();
      };

      requestRestore(workspaceId, agentId, (restore) => {
        if (restore.status !== 'restored') {
          release();
          return;
        }
        const draft = restore.draft;
        // Discard late restores after unmount, a pair change, or an
        // invalidation (the composer's current state won the race).
        if (
          destroyed ||
          !(options.active?.() ?? true) ||
          restoreKey !== key ||
          restoreGeneration !== generation
        )
          return;
        // User typing is authoritative — never overwrite a non-empty
        // composer with restored text or attachments.
        const userHasTyped = !!options.inputValue();
        if (!userHasTyped && draft?.attachments?.length && options.contextItems().length === 0) {
          options.setContextItems(deserializeDraftAttachments(draft.attachments));
        }
        if (!userHasTyped && draft?.text) {
          options.setInputValue(draft.text);
          hydrateTimeoutId = setTimeout(() => {
            // Re-check: skip if the user edited during the hydration window.
            if ((options.active?.() ?? true) && options.inputValue() === draft.text) {
              options.applyEditorContent(draft.text);
            }
          }, HYDRATE_DELAY_MS);
        }
        // A save that completed before this late restore is newer than the
        // daemon snapshot we just fetched — keep it. Otherwise this settled
        // restore seeds the cache (including the empty case) so a future
        // switch-back to this pair hydrates instantly.
        if (lastPersisted === null) {
          const text = draft?.text ?? '';
          const attachments = draft?.attachments ?? [];
          lastPersisted = { text, attachmentsJson: JSON.stringify(attachments) };
          setCachedDraft(workspaceId, agentId, { text, attachments });
        }
        release();
      });
    });
  });

  // Save draft to backend (debounced)
  $effect(() => {
    const active = options.active?.() ?? true;
    const workspaceId = options.workspaceId();
    const agentId = options.agentId();
    const gated = gateActive;
    if (!active) {
      untrack(cancelPendingSave);
      return;
    }
    if (!workspaceId || !agentId) return;
    const currentValue = options.inputValue();
    const currentAttachments = serializeDraftAttachments(options.contextItems());

    untrack(cancelPendingSave);
    // No saves while the initial restore gates the composer.
    if (gated) return;
    // Restore never settled (timeout/error): only persist real user content —
    // an empty save here could erase a draft the daemon still holds.
    if (lastPersisted === null && !currentValue && currentAttachments.length === 0) return;
    // Skip no-op saves matching the last known persisted state.
    const attachmentsJson = JSON.stringify(currentAttachments);
    if (
      lastPersisted !== null &&
      lastPersisted.text === currentValue &&
      lastPersisted.attachmentsJson === attachmentsJson
    ) {
      return;
    }

    // The saga debounces the write, refreshes the switch-back cache when it
    // commits, and rolls that cache back to `rollback` if the write fails.
    const saveKey = `${workspaceId}\u0000${agentId}`;
    const invalidationsAtSchedule = invalidations;
    const requestId = crypto.randomUUID();
    saveHandlers[requestId] = (outcome) => {
      if (!(options.active?.() ?? true)) return;
      if (outcome.status === 'saved') {
        // Only track dirty state if this pair is still the current one.
        if (restoreKey === saveKey && invalidations === invalidationsAtSchedule) {
          lastPersisted = { text: currentValue, attachmentsJson };
        }
        return;
      }
      options.onSaveError?.(new Error(outcome.error));
    };
    untrack(() => {
      pendingSaveRequestId = requestId;
      port.dispatch(
        chatDraftSaveScheduled(ownerId, requestId, {
          workspaceId,
          agentId,
          text: currentValue,
          attachments: currentAttachments,
          rollback: lastPersisted
            ? { text: lastPersisted.text, attachments: JSON.parse(lastPersisted.attachmentsJson) }
            : null,
        }),
      );
    });
  });

  // Teardown: flush the pending save (persisting the final keystrokes), then
  // ensure no editor writes fire after unmount.
  $effect(() => {
    return () => {
      destroyed = true;
      if (gateTimeoutId) clearTimeout(gateTimeoutId);
      if (gateVisibleTimeoutId) clearTimeout(gateVisibleTimeoutId);
      if (hydrateTimeoutId) clearTimeout(hydrateTimeoutId);
      flushPendingSave();
      unsubscribe();
      port.dispatch(chatDraftOwnerReleased(ownerId));
    };
  });

  return {
    get gateActive() {
      return gateActive;
    },
    get gateVisible() {
      return gateVisible;
    },
    invalidatePendingRestore() {
      restoreGeneration += 1;
      invalidations += 1;
      dropRestore();
      if (gateTimeoutId) {
        clearTimeout(gateTimeoutId);
        gateTimeoutId = null;
      }
      if (hydrateTimeoutId) {
        clearTimeout(hydrateTimeoutId);
        hydrateTimeoutId = null;
      }
      gateActive = false;
      clearGateVisible();
      // The send made the pre-send draft obsolete everywhere: discard a
      // pending debounced save of it (flushing at unmount would resurrect it
      // on the daemon) and reflect the cleared state in the switch-back
      // cache and dirty-tracking, so an unmount/rebind before the reactive
      // empty save cannot cache-hydrate the just-sent prompt on reopen.
      cancelPendingSave();
      if (restoreKey !== null) {
        const [workspaceId, agentId] = restoreKey.split('\u0000');
        setCachedDraft(workspaceId, agentId, { text: '', attachments: [] });
        lastPersisted = { text: '', attachmentsJson: '[]' };
      }
    },
  };
}
