import { fromDockDraftEvidence } from '$shared/dock-evidence';
import type { DockSavedMedia } from '$shared/dock-media-edit';
import type { DockCaptureEditorSnapshot } from '$shared/dock-capture-editor';
import { createChatMediaNative } from '$features/hud/composer/chat-media-native';
import { store } from '$store/renderer/store';
import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';
import { readDraftAttachmentScreens } from './chat-draft-attachments';
import type { ChatDraftCapture, ChatDraftManager } from './chat-panel-draft.svelte';

/** Presentation reads the same validated evidence as send; it never invents a source. */
export function chatRecordingEvidence(capture: ChatDraftCapture | null) {
  if (!capture) return null;
  const evidence = fromDockDraftEvidence(
    JSON.stringify([capture.workspaceId, capture.agentId]),
    readDraftAttachmentScreens(capture.attachments),
    capture.attachments.map((item) => ({
      contextItemId: item.id,
      attachmentId: item.attachmentId,
      path: item.path,
    })),
  );
  return {
    ...evidence,
    clips: evidence.clips.filter((clip) => {
      const item = capture.attachments.find((item) => item.id === clip.contextItemId);
      return !!clip.media && !clip.mediaError && !!item && clip.path === item.path;
    }),
  };
}

/** Readiness uses the existing offline, document-bound lease; never dock capture authority. */
export async function readChatRecordingOutput(
  capture: ChatDraftCapture,
  media: DockSavedMedia,
  drafts: ChatDraftManager,
): Promise<NonNullable<DockCaptureEditorSnapshot['output']>> {
  const principal = store.state.principal.snapshot;
  const current = () =>
    getPrincipalActionContext(store.state) === capture.authority && drafts.isCurrentDraft(capture);
  if (!principal || !current() || !(await drafts.flushDraft(capture)) || !current())
    return { ready: false };
  const abort = new AbortController();
  const native = createChatMediaNative(
    {
      workspaceId: capture.workspaceId,
      agentId: capture.agentId,
      principalId: principal.principal.id,
      draftId: crypto.randomUUID(),
      media: [media],
    },
    current,
    abort.signal,
  );
  try {
    const result = await native.readiness();
    if (!current() || !result.ok) return { ready: false };
    return result.value.find((output) => output.sourceId === media.source.id) ?? { ready: false };
  } finally {
    await native.dispose();
  }
}
