import { onDestroy } from 'svelte';
import {
  applyDockMediaSave,
  type DockMediaEdit,
  type DockSavedMedia,
} from '$shared/dock-media-edit';
import { toDockDraftEvidence } from '$shared/dock-evidence';
import type {
  DockCaptureEditorSnapshot,
  DockCaptureEditorSaveResult,
} from '$shared/dock-capture-editor';
import { dockRecordingEditorRequest } from '$features/hud/media-editor/open-capture-editor';
import { dockClipPlaybackUrl } from '$features/hud/composer/dock-composer-presentation';
import type { ChatDraftCapture, ChatDraftManager } from './chat-panel-draft.svelte';
import { chatRecordingEvidence, readChatRecordingOutput } from './chat-recording-attachments';

/** Coordinates the existing editor with its existing draft owner, never a second draft. */
export function createChatRecordingEditor(options: {
  capture: () => ChatDraftCapture | null;
  drafts: ChatDraftManager;
  disabled: () => boolean;
  onRemove: (id: string) => boolean;
  prepareOutput?: typeof readChatRecordingOutput;
}) {
  let editing = $state.raw<{
    capture: ChatDraftCapture;
    contextItemId: string;
    snapshot: DockCaptureEditorSnapshot;
  } | null>(null);
  let opening = $state(false);
  let problem = $state(false);
  let opener: HTMLElement | null = null;
  let active = true;
  let generation = 0;
  // A failed durability wait leaves the local edit intact, just like typed draft text.
  // A retry may advance only this exact local descriptor, never a peer's edit.
  let attempted: { openId: string; media: DockSavedMedia; inputRevision: number } | null = null;
  onDestroy(() => {
    active = false;
    generation++;
  });
  $effect(() => {
    const current = options.capture();
    if (
      editing &&
      (!current ||
        current.authority !== editing.capture.authority ||
        current.ownerId !== editing.capture.ownerId ||
        current.workspaceId !== editing.capture.workspaceId ||
        current.agentId !== editing.capture.agentId ||
        current.attachmentEpoch !== editing.capture.attachmentEpoch)
    )
      editing = null;
  });
  async function edit(id: string): Promise<void> {
    if (options.disabled() || opening) return;
    const clicked = options.drafts.captureDraft();
    const currentEvidence = chatRecordingEvidence(clicked);
    const clip = currentEvidence?.clips.find((clip) => clip.contextItemId === id);
    if (!clicked || !clip?.media || !currentEvidence) return;
    const request = dockRecordingEditorRequest({
      workspaceId: clicked.workspaceId,
      agentId: clicked.agentId,
      clip,
      evidence: currentEvidence,
      marks: currentEvidence.marks,
    });
    const mediaUrl = dockClipPlaybackUrl(clicked.workspaceId, clip.path);
    if (!request || !mediaUrl) return;
    const ticket = ++generation;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    opening = true;
    problem = false;
    try {
      const output = await (options.prepareOutput ?? readChatRecordingOutput)(
        clicked,
        clip.media,
        options.drafts,
      );
      if (!active || generation !== ticket || !options.drafts.isCurrentDraft(clicked)) return;
      const { attachmentPath: _path, ...snapshot } = request;
      editing = {
        capture: clicked,
        contextItemId: id,
        snapshot: { ...snapshot, openId: crypto.randomUUID(), mediaUrl, output, deleteReady: true },
      };
    } catch {
      if (active && generation === ticket) problem = true;
    } finally {
      if (active && generation === ticket) opening = false;
    }
  }
  async function save(edit: DockMediaEdit): Promise<DockCaptureEditorSaveResult> {
    const requestId = crypto.randomUUID();
    const opened = editing;
    const current = options.drafts.captureDraft();
    if (
      !opened ||
      !current ||
      current.authority !== opened.capture.authority ||
      current.ownerId !== opened.capture.ownerId ||
      current.workspaceId !== opened.capture.workspaceId ||
      current.agentId !== opened.capture.agentId ||
      current.attachmentEpoch !== opened.capture.attachmentEpoch
    )
      return { requestId, result: 'stale-source' };
    const live = chatRecordingEvidence(current);
    const clip = live?.clips.find((clip) => clip.contextItemId === opened.contextItemId);
    if (!live || !clip?.media) return { requestId, result: 'stale-source' };
    const ownedRetry =
      attempted?.openId === opened.snapshot.openId &&
      attempted.inputRevision === edit.revision &&
      JSON.stringify(attempted.media) === JSON.stringify(clip.media);
    const candidate = ownedRetry ? { ...edit, revision: clip.media.saved?.revision ?? 0 } : edit;
    const result = applyDockMediaSave(clip.media, {
      openId: opened.snapshot.openId,
      ...(opened.snapshot.output?.version === 2 ? { outputVersion: 2 as const } : {}),
      pair: { workspaceId: current.workspaceId, agentId: current.agentId },
      sourceId: edit.sourceId,
      sourceRevision: edit.sourceRevision,
      expectedEditRevision: candidate.revision,
      edit: candidate,
    });
    if (result.status !== 'saved')
      return { requestId, result: result.status === 'invalid-edit' ? 'failed' : result.status };
    const next = toDockDraftEvidence({
      ...live,
      clips: live.clips.map((row) => (row.id === clip.id ? { ...row, media: result.media } : row)),
    })[opened.contextItemId];
    const updated = options.drafts.updateAttachmentScreen(current, opened.contextItemId, next);
    if (!updated) return { requestId, result: 'stale-source' };
    attempted = {
      openId: opened.snapshot.openId,
      media: result.media,
      inputRevision: edit.revision,
    };
    try {
      // No await separates this entry fence from flushDraft. Its early false path
      // cannot apply; after entry it awaits persistence, then false means newer
      // typing. Accept that typing only while this exact attachment lease survives.
      if (!options.drafts.isCurrentDraft(updated)) return { requestId, result: 'stale-source' };
      await options.drafts.flushDraft(updated);
      const latest = options.drafts.captureDraft();
      if (
        !active ||
        editing?.snapshot.openId !== opened.snapshot.openId ||
        !latest ||
        latest.attachmentEpoch !== opened.capture.attachmentEpoch ||
        latest.authority !== updated.authority ||
        latest.ownerId !== updated.ownerId ||
        latest.workspaceId !== updated.workspaceId ||
        latest.agentId !== updated.agentId ||
        JSON.stringify(
          latest.attachments.find((item) => item.id === opened.contextItemId)?.screen,
        ) !== JSON.stringify(next)
      )
        return { requestId, result: 'stale-source' };
      attempted = null;
      return { requestId, result: 'saved', saved: result.media.saved ?? undefined };
    } catch {
      return { requestId, result: 'failed' };
    }
  }
  function remove(id: string): boolean {
    if (options.disabled() || !options.onRemove(id)) return false;
    if (editing?.contextItemId === id) editing = null;
    return true;
  }
  return {
    get session() {
      return editing;
    },
    get opening() {
      return opening;
    },
    get problem() {
      return problem;
    },
    open: edit,
    save,
    remove,
    close() {
      editing = null;
    },
    restoreFocus() {
      if (opener?.isConnected) opener.focus();
    },
  };
}
