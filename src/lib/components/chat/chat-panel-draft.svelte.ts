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
 * `gateVisible` (500ms) so a fast restore never blinks a spinner.
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
 * A process-lifetime `chat-draft-cache` (per `(workspaceId, agentId)`) makes
 * switch-back instant: a cache hit hydrates the composer synchronously with
 * no gate, then `drafts.get` still runs in the background to revalidate and
 * refresh the cache — applying its result to the composer only if the user
 * hasn't typed since the cache hydrated it. A cache miss (first-ever visit
 * to the pair) keeps the original gated restore below.
 */
import { untrack } from 'svelte';

import type { DraftsClient } from '$lib/client/app-client';
import { getCachedDraft, setCachedDraft } from './chat-draft-cache';
import { serializeDraftAttachments, deserializeDraftAttachments } from './chat-draft-attachments';
import type { ContextItem } from './input/context-api';

export interface ChatDraftManagerOptions {
  drafts: Pick<DraftsClient, 'get' | 'set'>;
  workspaceId: () => string | undefined;
  agentId: () => string | undefined;
  inputValue: () => string;
  setInputValue: (text: string) => void;
  contextItems: () => ContextItem[];
  setContextItems: (items: ContextItem[]) => void;
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
   * its own (ChatPanel's send cleanup empties the composer and issues
   * `drafts.clear`). The manager only stops competing with that ownership.
   */
  invalidatePendingRestore(): void;
}

/** Delay before pushing restored text into the editor (lets it mount). */
const HYDRATE_DELAY_MS = 50;
/** Debounce for persisting the draft to the daemon. */
const SAVE_DEBOUNCE_MS = 500;
/** Fallback: release the composer gate if `drafts.get` hasn't settled. */
const GATE_TIMEOUT_MS = 5000;
/** Delay before the gate becomes visible as a loading indicator. */
const GATE_VISIBLE_DELAY_MS = 500;

export function createChatDraftManager(options: ChatDraftManagerOptions): ChatDraftManager {
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
  let saveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  // Debounced save awaiting its timer; flushed on pair change and unmount so
  // the last keystrokes are persisted instead of dropped.
  let pendingSave: (() => void) | null = null;

  const clearGateVisible = () => {
    if (gateVisibleTimeoutId) {
      clearTimeout(gateVisibleTimeoutId);
      gateVisibleTimeoutId = null;
    }
    gateVisible = false;
  };

  const flushPendingSave = () => {
    if (saveTimeoutId) {
      clearTimeout(saveTimeoutId);
      saveTimeoutId = null;
    }
    const run = pendingSave;
    pendingSave = null;
    run?.();
  };

  // Restore draft from backend on mount and on (workspaceId, agentId) change
  $effect(() => {
    const workspaceId = options.workspaceId();
    const agentId = options.agentId();
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
        options.setContextItems([]);
        options.applyEditorContent('');
      }

      const cached = getCachedDraft(workspaceId, agentId);
      if (cached) {
        // Cache hit: hydrate synchronously, no gate — switch-back to a
        // previously visited pair never shows the loading indicator,
        // regardless of the background revalidation's latency.
        gateActive = false;
        const hydratedText = cached.text;
        const hydratedAttachmentsJson = JSON.stringify(cached.attachments);
        options.setInputValue(cached.text);
        options.setContextItems(deserializeDraftAttachments(cached.attachments));
        options.applyEditorContent(cached.text);
        lastPersisted = { text: cached.text, attachmentsJson: hydratedAttachmentsJson };

        options.drafts
          .get(workspaceId, agentId)
          .then((draft) => {
            // Discard late revalidations after unmount, a pair change, or an
            // invalidation (the composer's current state won the race).
            if (destroyed || restoreKey !== key || restoreGeneration !== generation) return;
            const freshText = draft?.text ?? '';
            const freshAttachments = draft?.attachments ?? [];
            const freshAttachmentsJson = JSON.stringify(freshAttachments);
            setCachedDraft(workspaceId, agentId, { text: freshText, attachments: freshAttachments });

            // User typing is authoritative — only apply the revalidated
            // result if the composer still matches what the cache hydrated.
            const untouched =
              options.inputValue() === hydratedText &&
              JSON.stringify(serializeDraftAttachments(options.contextItems())) === hydratedAttachmentsJson;
            if (!untouched) return;
            if (freshText !== hydratedText) {
              options.setInputValue(freshText);
              options.applyEditorContent(freshText);
            }
            if (freshAttachmentsJson !== hydratedAttachmentsJson) {
              options.setContextItems(deserializeDraftAttachments(freshAttachments));
            }
            lastPersisted = { text: freshText, attachmentsJson: freshAttachmentsJson };
          })
          .catch(() => {
            // Keep the cached hydration — nothing to release since the
            // cache-hit path never gates the composer.
          });
        return;
      }

      // Cache miss (first-ever visit to this pair): gated restore, unchanged.
      gateActive = true;
      // The spinner only earns its place once the restore is visibly slow.
      gateVisibleTimeoutId = setTimeout(() => {
        gateVisibleTimeoutId = null;
        gateVisible = true;
      }, GATE_VISIBLE_DELAY_MS);
      gateTimeoutId = setTimeout(() => {
        gateActive = false;
        clearGateVisible();
      }, GATE_TIMEOUT_MS);
      const release = () => {
        if (restoreKey !== key || restoreGeneration !== generation) return;
        if (gateTimeoutId) clearTimeout(gateTimeoutId);
        gateActive = false;
        clearGateVisible();
      };

      options.drafts
        .get(workspaceId, agentId)
        .then((draft) => {
          // Discard late restores after unmount, a pair change, or an
          // invalidation (the composer's current state won the race).
          if (destroyed || restoreKey !== key || restoreGeneration !== generation) return;
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
              if (options.inputValue() === draft.text) {
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
        })
        .catch(() => {
          release();
        });
    });
  });

  // Save draft to backend (debounced)
  $effect(() => {
    const workspaceId = options.workspaceId();
    const agentId = options.agentId();
    const gated = gateActive;
    if (!workspaceId || !agentId) return;
    const currentValue = options.inputValue();
    const currentAttachments = serializeDraftAttachments(options.contextItems());

    if (saveTimeoutId) {
      clearTimeout(saveTimeoutId);
      saveTimeoutId = null;
    }
    pendingSave = null;
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

    const saveKey = `${workspaceId}\u0000${agentId}`;
    const doSave = () => {
      saveTimeoutId = null;
      pendingSave = null;
      // Refresh the switch-back cache synchronously: a flush-at-unmount must
      // be visible to an immediate remount of the same pair, which hydrates
      // from this cache before the wire save settles.
      setCachedDraft(workspaceId, agentId, {
        text: currentValue,
        attachments: currentAttachments,
      });
      options.drafts
        .set(
          workspaceId,
          agentId,
          currentValue,
          currentAttachments.length > 0 ? currentAttachments : undefined,
        )
        .then(() => {
          // Only track dirty state if this pair is still the current one.
          if (restoreKey === saveKey) {
            lastPersisted = { text: currentValue, attachmentsJson };
            // Re-assert the cache on success: an interleaved older save's
            // failure rollback (below) must not outlive a newer accepted save.
            setCachedDraft(workspaceId, agentId, {
              text: currentValue,
              attachments: currentAttachments,
            });
          }
        })
        .catch((err) => {
          // The synchronous cache write above advertised text the daemon
          // never accepted — roll it back to the last persisted state so a
          // switch-back cache-hit hydrates what the daemon actually holds.
          // (When no persisted state is known the optimistic write stands;
          // there is nothing better to revert to.)
          if (restoreKey === saveKey && lastPersisted !== null) {
            setCachedDraft(workspaceId, agentId, {
              text: lastPersisted.text,
              attachments: JSON.parse(lastPersisted.attachmentsJson),
            });
          }
          options.onSaveError?.(err);
        });
    };
    pendingSave = doSave;
    saveTimeoutId = setTimeout(doSave, SAVE_DEBOUNCE_MS);
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
      if (saveTimeoutId) {
        clearTimeout(saveTimeoutId);
        saveTimeoutId = null;
      }
      pendingSave = null;
      if (restoreKey !== null) {
        const [workspaceId, agentId] = restoreKey.split('\u0000');
        setCachedDraft(workspaceId, agentId, { text: '', attachments: [] });
        lastPersisted = { text: '', attachmentsJson: '[]' };
      }
    },
  };
}
