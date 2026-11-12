import { store } from '$store/renderer/store';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';
import { selectDockComposerEvidence } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
import { selectWorkspaceParticipationContext } from '$store/renderer/slices/workspace/workspace-selectors';
import { dockEvidenceId, type DockEvidenceNativeService } from '$shared/dock-evidence';
import { captureDockPlacementBinding, isDockBindingCurrent } from './dock-evidence-placement';
import { createRecordingWarmSlot } from './recording-warm-slot';
import type { DockMediaSendService } from './dock-media-send';

export interface DockRecordingReview {
  openId: string;
  logicalId: string;
  workspaceId: string;
  agentId: string;
  authority: string;
  generation: number;
}
/** Lives exactly as long as the installed dock native adapter, never a cross-window cache. */
export function createDockRecordingWarm(native: DockEvidenceNativeService) {
  const slot = createRecordingWarmSlot(native);
  let dead = false;
  let attempted: string | null = null;
  let review: (DockRecordingReview & { attaching?: boolean; returning?: boolean }) | null = null;
  const ownsReview = () =>
    !!review &&
    review.workspaceId === store.state.dockConversation.workspaceId &&
    review.agentId === store.state.dockConversation.agentId &&
    review.authority === getPrincipalActionContext(store.state) &&
    review.generation === store.state.dockConversation.generation;
  function snapshot() {
    const dock = store.state.dockConversation;
    const { workspaceId, agentId, authority, generation } = dock;
    if (
      !workspaceId ||
      !agentId ||
      !authority ||
      authority !== getPrincipalActionContext(store.state)
    )
      return null;
    const view = selectDockComposerEvidence.select(store.state, workspaceId, agentId);
    const draft = getItem(dock.drafts, dockEvidenceId(workspaceId, agentId));
    if (
      !draft?.restored ||
      view.recording ||
      view.annotating ||
      view.capturePending ||
      view.speech.active ||
      view.insertionsQueued
    )
      return null;
    const clip = view.clips.find(
      (row) =>
        !row.discarding &&
        row.status !== 'recording' &&
        row.status !== 'placing' &&
        !row.mediaError &&
        row.media &&
        (!ownsReview() || row.id === review!.logicalId),
    );
    if (!clip?.media) return null;
    const participation = selectWorkspaceParticipationContext.select(store.state, workspaceId);
    if (!participation) return null;
    const binding = captureDockPlacementBinding();
    const scopeCurrent = () =>
      !dead &&
      store.state.dockConversation.generation === generation &&
      store.state.dockConversation.workspaceId === workspaceId &&
      store.state.dockConversation.agentId === agentId &&
      getPrincipalActionContext(store.state) === authority &&
      isDockBindingCurrent(binding) &&
      selectWorkspaceParticipationContext.select(store.state, workspaceId) === participation;
    const key = JSON.stringify([workspaceId, agentId, authority, generation, clip.id, clip.media]);
    return { key, media: clip.media, scopeCurrent };
  }
  // Focus can briefly land on body when Send disables/remounts its button.
  // Retain the last composer interaction until an actual outside focus/click or
  // window blur, rather than treating that internal transition as owner loss.
  let composerFocused =
    typeof document !== 'undefined' &&
    !!document.activeElement?.closest('[data-dock-conversation]');
  const active = () => typeof document !== 'undefined' && document.hasFocus() && composerFocused;
  const update = () => {
    if (review && !ownsReview()) review = null;
    if (review?.returning && active()) review = null;
    const value = snapshot();
    if (!value || (!active() && !ownsReview() && !store.state.dockConversation.sending)) {
      slot.cancel();
      return;
    }
    if (store.state.dockConversation.sending) return;
    if (attempted === value.key) return;
    attempted = value.key;
    slot.warm(value.key, value.media, () => value.scopeCurrent() && snapshot()?.key === value.key);
  };
  const focusChanged = (event: Event) => {
    if (event.type === 'blur') composerFocused = false;
    else if (event.type === 'focusin' || event.type === 'pointerdown')
      composerFocused =
        event.target instanceof Element && !!event.target.closest('[data-dock-conversation]');
    else composerFocused = !!document.activeElement?.closest('[data-dock-conversation]');
    update();
  };
  const unsubscribe = store.getReadableState().subscribe(update);
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', focusChanged);
    window.addEventListener('blur', focusChanged);
    window.addEventListener('focusin', focusChanged);
    window.addEventListener('pointerdown', focusChanged);
  }
  const service: DockEvidenceNativeService & DockMediaSendService = {
    ...native,
    takePreparedRecording: async (media) => {
      const value = snapshot();
      return value ? slot.take(value.key, media, value.scopeCurrent) : null;
    },
  };
  return {
    service,
    reviewOpened(next: DockRecordingReview | null) {
      if (!next || (review && review.logicalId !== next.logicalId)) slot.cancel();
      review = next;
      attempted = null;
      update();
    },
    reviewEnded(openId: string) {
      if (review?.openId !== openId || review.attaching) return;
      review = null;
      slot.cancel();
    },
    beginReturn(openId: string) {
      if (review?.openId === openId) review.attaching = true;
    },
    finishReturn(openId: string, accepted: boolean) {
      if (review?.openId !== openId) return;
      if (!accepted) {
        review = null;
        slot.cancel();
        return;
      }
      review.attaching = false;
      review.returning = true;
      update();
    },
    dispose() {
      dead = true;
      unsubscribe();
      slot.cancel();
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', focusChanged);
        window.removeEventListener('blur', focusChanged);
        window.removeEventListener('focusin', focusChanged);
        window.removeEventListener('pointerdown', focusChanged);
      }
    },
  };
}
