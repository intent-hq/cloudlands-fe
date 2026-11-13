import { onDestroy, onMount, untrack } from 'svelte';
import { store } from '$store/renderer/store';
import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';
import { selectWorkspaceParticipationContext } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  captureDockPlacementBinding,
  isDockBindingCurrent,
} from '$features/hud/composer/dock-evidence-placement';
import { createChatMediaNative } from '$features/hud/composer/chat-media-native';
import { createRecordingWarmSlot } from '$features/hud/composer/recording-warm-slot';
import { chatRecordingEvidence } from './chat-recording-attachments';
import type { ChatDraftCapture, ChatDraftManager } from './chat-panel-draft.svelte';
import type { DockMediaSendService } from '$features/hud/composer/dock-media-send';

export interface ChatRecordingWarmLease {
  service: DockMediaSendService;
  dispose(): Promise<void>;
}
export interface ChatRecordingWarmOwner {
  take(capture: ChatDraftCapture, signal: AbortSignal): ChatRecordingWarmLease | null;
  cancel(): Promise<void>;
  beforeEditorOpen(): Promise<void>;
  editorState(opening: boolean, review: { openId: string; capture: ChatDraftCapture } | null): void;
}
const captureKey = (capture: ChatDraftCapture) =>
  JSON.stringify([
    capture.authority,
    capture.ownerId,
    capture.workspaceId,
    capture.agentId,
    capture.attachmentEpoch,
    capture.attachments,
  ]);
/** Composer-owned only. The editor readiness lease is admitted after cancel completes. */
export function createChatRecordingWarm(options: {
  capture(): ChatDraftCapture | null;
  active(): boolean;
  drafts: Pick<ChatDraftManager, 'isCurrentDraft' | 'flushDraft' | 'gateActive'>;
}): ChatRecordingWarmOwner {
  let focused = $state(false);
  let editorOpening = $state(false);
  let review = $state.raw<{ openId: string; key: string } | null>(null);
  let destroyed = false;
  let serial = 0;
  let attemptedKey: string | null = null;
  type Owned = {
    key: string;
    capture: ChatDraftCapture;
    abort: AbortController;
    native: ReturnType<typeof createChatMediaNative> | null;
    slot: ReturnType<typeof createRecordingWarmSlot> | null;
    current(): boolean;
  };
  let owned: Owned | null = null;
  async function close(value: Owned) {
    value.abort.abort();
    value.slot?.cancel();
    await value.native?.dispose();
  }
  async function cancel() {
    serial++;
    const value = owned;
    owned = null;
    if (value) await close(value);
  }
  onMount(() => {
    const update = () => {
      focused = document.hasFocus();
    };
    update();
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
    };
  });
  const unsubscribe = store.getReadableState().subscribe(() => {
    if (owned && !owned.current()) void cancel();
  });
  onDestroy(() => {
    destroyed = true;
    unsubscribe();
    void cancel();
  });
  $effect(() => {
    const capture = options.capture();
    const key = capture ? captureKey(capture) : '';
    const active = focused && !editorOpening && (options.active() || review?.key === key);
    untrack(() => {
      if (!active || !capture) {
        void cancel();
        return;
      }
      if (owned?.key === key) return;
      if (attemptedKey === key) {
        void cancel();
        return;
      }
      void cancel();
      const evidence = chatRecordingEvidence(capture);
      const allMedia =
        evidence?.clips.flatMap((clip) => (!clip.mediaError && clip.media ? [clip.media] : [])) ??
        [];
      const media = allMedia[0];
      const principal = store.state.principal.snapshot;
      const participation = selectWorkspaceParticipationContext.select(
        store.state,
        capture.workspaceId,
      );
      if (!media || !principal || !participation || options.drafts.gateActive) return;
      const binding = captureDockPlacementBinding();
      const abort = new AbortController();
      const current = () =>
        !destroyed &&
        !abort.signal.aborted &&
        getPrincipalActionContext(store.state) === capture.authority &&
        selectWorkspaceParticipationContext.select(store.state, capture.workspaceId) ===
          participation &&
        isDockBindingCurrent(binding) &&
        !!options.capture() &&
        captureKey(options.capture()!) === key;
      const value: Owned = { key, capture, abort, native: null, slot: null, current };
      owned = value;
      const ticket = serial;
      // Flush only this unchanged snapshot; no attachment placement or transcription.
      void options.drafts
        .flushDraft(capture)
        .then(async (flushed) => {
          if (owned !== value || ticket !== serial || !current()) return;
          if (!flushed) {
            attemptedKey = key;
            await cancel();
            return;
          }
          value.native = createChatMediaNative(
            {
              workspaceId: capture.workspaceId,
              agentId: capture.agentId,
              draftId: crypto.randomUUID(),
              principalId: principal.principal.id,
              media: structuredClone(allMedia),
            },
            current,
            abort.signal,
          );
          value.slot = createRecordingWarmSlot(value.native.service);
          attemptedKey = key;
          value.slot.warm(key, media, current);
        })
        .catch(() => {
          if (owned === value) void cancel();
        });
    });
  });
  return {
    cancel,
    async beforeEditorOpen() {
      editorOpening = true;
      attemptedKey = null;
      await cancel();
    },
    editorState(opening, next) {
      editorOpening = opening;
      const nextKey = next ? captureKey(next.capture) : null;
      if (next && review?.openId !== next.openId) attemptedKey = null;
      review = next && nextKey ? { openId: next.openId, key: nextKey } : null;
    },
    take(capture, signal) {
      const value = owned;
      if (!value?.native || !value.slot || value.key !== captureKey(capture) || !value.current()) {
        void cancel();
        return null;
      }
      owned = null;
      serial++;
      const native = value.native,
        slot = value.slot;
      const abort = () => value.abort.abort();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      return {
        service: {
          ...native.service,
          takePreparedRecording: (media) =>
            slot.take(value.key, media, () => !signal.aborted && value.current()),
        },
        async dispose() {
          signal.removeEventListener('abort', abort);
          await close(value);
        },
      };
    },
  };
}
