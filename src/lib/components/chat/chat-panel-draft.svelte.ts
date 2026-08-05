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
 * daemon doesn't answer.
 *
 * The restore re-runs whenever the `(workspaceId, agentId)` pair changes:
 * the composer resets, the gate re-arms, dirty-tracking resets, and a
 * late-resolving restore for a previous pair is discarded. A debounced save
 * still pending at a pair change or unmount is flushed (persisting the final
 * keystrokes); all other timers are torn down so no editor writes fire after
 * destroy.
 */
import { untrack } from 'svelte';

import type { DraftsClient } from '$lib/client/app-client';
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
}

/** Delay before pushing restored text into the editor (lets it mount). */
const HYDRATE_DELAY_MS = 50;
/** Debounce for persisting the draft to the daemon. */
const SAVE_DEBOUNCE_MS = 500;
/** Fallback: release the composer gate if `drafts.get` hasn't settled. */
const GATE_TIMEOUT_MS = 5000;

export function createChatDraftManager(options: ChatDraftManagerOptions): ChatDraftManager {
  let gateActive = $state(false);
  // Last state known to match the daemon's copy (restored or saved). Null
  // until the restore settles — while unknown, empty saves are suppressed so
  // a fresh mount can never erase a persisted draft.
  let lastPersisted: { text: string; attachmentsJson: string } | null = null;
  // (workspaceId, agentId) pair whose restore is current (in flight or done).
  let restoreKey: string | null = null;
  let destroyed = false;
  let gateTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let hydrateTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let saveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  // Debounced save awaiting its timer; flushed on pair change and unmount so
  // the last keystrokes are persisted instead of dropped.
  let pendingSave: (() => void) | null = null;

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

    untrack(() => {
      // A previous pair's restore/hydration no longer applies.
      lastPersisted = null;
      if (gateTimeoutId) clearTimeout(gateTimeoutId);
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
      gateActive = true;
      gateTimeoutId = setTimeout(() => {
        gateActive = false;
      }, GATE_TIMEOUT_MS);
      const release = () => {
        if (restoreKey !== key) return;
        if (gateTimeoutId) clearTimeout(gateTimeoutId);
        gateActive = false;
      };

      options.drafts
        .get(workspaceId, agentId)
        .then((draft) => {
          // Discard late restores after unmount or a pair change.
          if (destroyed || restoreKey !== key) return;
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
          // daemon snapshot we just fetched — keep it.
          if (lastPersisted === null) {
            lastPersisted = {
              text: draft?.text ?? '',
              attachmentsJson: JSON.stringify(draft?.attachments ?? []),
            };
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
          }
        })
        .catch((err) => {
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
      if (hydrateTimeoutId) clearTimeout(hydrateTimeoutId);
      flushPendingSave();
    };
  });

  return {
    get gateActive() {
      return gateActive;
    },
  };
}
