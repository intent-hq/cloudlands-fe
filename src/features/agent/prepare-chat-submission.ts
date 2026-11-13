/** Application send service: freeze, durably flush, prepare, then enter the ordinary outbox. */
import { store as appStore } from '$store/renderer/store';
import { appClient } from '$lib/client';
import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';
import { selectPrincipalSnapshot } from '$store/renderer/slices/principal/principal-selectors';
import { selectWorkspaceParticipationContext } from '$store/renderer/slices/workspace/workspace-selectors';
import { chatSendFailed } from '$store/renderer/slices/chat-state/chat-state-slice';
import type { SendMessagePayload } from '$store/renderer/slices/chat-state/chat-state-types';
import { readDraftAttachmentScreens } from '$lib/components/chat/chat-draft-attachments';
import type { ChatDraftCapture } from '$lib/components/chat/chat-panel-draft.svelte';
import { extractAttachmentBlocks } from '$lib/components/chat/composer-submission';
import { hasBlockingAttachments, type ContextItem } from '$lib/components/chat/input/context-api';
import { fromDockDraftEvidence, dockEvidenceId, validDockWireTokens } from '$shared/dock-evidence';
import {
  captureDockPlacementBinding,
  isDockBindingCurrent,
} from '$features/hud/composer/dock-evidence-placement';
import {
  evidenceMessageItems,
  prepareEvidenceMessage,
} from '$features/hud/composer/prepare-evidence-message';
import { createChatMediaNative } from '$features/hud/composer/chat-media-native';
import { submitChatMessage } from './chat-submission';
import { m } from '$shared/paraglide/messages.js';
import type {
  ChatRecordingWarmOwner,
  ChatRecordingWarmLease,
} from '$lib/components/chat/chat-recording-warm.svelte';

export type PreparedChatDraftCapture = ChatDraftCapture;
export interface PreparedChatDraftPort {
  isCurrentDraft(capture: PreparedChatDraftCapture): boolean;
  flushDraft(capture: PreparedChatDraftCapture): Promise<boolean>;
}
const active = new Set<string>();
/** Does not clean the editor. The owner conditionally clears only this exact capture after true. */
export async function submitPreparedChatMessage(input: {
  capture: PreparedChatDraftCapture;
  drafts: PreparedChatDraftPort;
  payload: SendMessagePayload & { wsId: string };
  items: ContextItem[];
  signal: AbortSignal;
  warm?: ChatRecordingWarmOwner;
}): Promise<boolean> {
  const { drafts, signal } = input;
  const capture = structuredClone(input.capture),
    clickedItems = structuredClone(input.items);
  const clickedPayload = structuredClone(input.payload);
  const { workspaceId, agentId } = capture;
  const authority = getPrincipalActionContext(appStore.state);
  const participation = selectWorkspaceParticipationContext.select(appStore.state, workspaceId);
  const principal = selectPrincipalSnapshot.select(appStore.state);
  const binding = captureDockPlacementBinding();
  const key = JSON.stringify([authority, workspaceId, agentId]);
  if (
    !authority ||
    !participation ||
    !principal ||
    clickedPayload.wsId !== workspaceId ||
    active.has(key)
  )
    return false;
  active.add(key);
  const abort = new AbortController();
  const cancelled = () => abort.abort();
  signal.addEventListener('abort', cancelled, { once: true });
  const current = () =>
    !signal.aborted &&
    !abort.signal.aborted &&
    getPrincipalActionContext(appStore.state) === authority &&
    selectWorkspaceParticipationContext.select(appStore.state, workspaceId) === participation &&
    isDockBindingCurrent(binding) &&
    drafts.isCurrentDraft(capture);
  // Retirement also stops a held native job, rather than waiting for it to return.
  const unsubscribe = appStore.getReadableState().subscribe(() => {
    if (!current()) abort.abort();
  });
  let native: ReturnType<typeof createChatMediaNative> | ChatRecordingWarmLease | null = null;
  try {
    if (!current() || hasBlockingAttachments(clickedItems)) return false;
    const screens = readDraftAttachmentScreens(capture.attachments);
    const evidence = fromDockDraftEvidence(
      dockEvidenceId(workspaceId, agentId),
      screens,
      clickedItems.map((item) => ({
        contextItemId: item.id,
        attachmentId: item.attachmentId,
        path: item.path,
      })),
    );
    // Invalid/unknown evidence is never downgraded to an ordinary source attachment.
    const restored = new Set(
      [...evidence.images, ...evidence.clips].map((row) => row.contextItemId),
    );
    if (
      screens.some(([id]) => !restored.has(id)) ||
      evidence.images.some((row) => row.mediaError) ||
      evidence.clips.some((row) => row.mediaError) ||
      !validDockWireTokens(clickedPayload.text, evidence)
    )
      throw new Error('invalid-evidence');
    native = input.warm?.take(capture, abort.signal) ?? null;
    if (!(await drafts.flushDraft(capture)) || !current()) return false;
    const target = await appClient.agents.get(agentId, workspaceId);
    if (!current()) return false;
    if (
      !target ||
      target.workspaceId !== workspaceId ||
      target.retiredAt ||
      target.pendingDeleteAt ||
      target.status === 'deleted'
    )
      throw new Error('unavailable');
    const media = evidence.clips.flatMap((row) => (row.media ? [row.media] : []));
    if (media.length && !native)
      native = createChatMediaNative(
        {
          workspaceId,
          agentId,
          draftId: crypto.randomUUID(),
          principalId: principal.principal.id,
          media,
        },
        current,
        abort.signal,
      );
    const sendItems = evidenceMessageItems(clickedItems, evidence);
    const blocks = extractAttachmentBlocks(sendItems);
    const payload = await prepareEvidenceMessage({
      workspaceId,
      agentId,
      evidence,
      clickedItems,
      sendItems,
      clickedPayload: {
        ...clickedPayload,
        contextItems: sendItems,
        imageBlocks: blocks.imageBlocks,
        fileBlocks: blocks.fileBlocks,
      },
      binding,
      service: native?.service ?? null,
      current,
      onRecord: () => {},
    });
    if (!payload || !current()) return false;
    // Every retry and queue entry receives these exact prepared references/metadata.
    return submitChatMessage(appStore, agentId, payload);
  } catch {
    if (current())
      appStore.dispatch(chatSendFailed(agentId, m.dock_conversation_sendFailed_error()));
    return false;
  } finally {
    unsubscribe();
    signal.removeEventListener('abort', cancelled);
    await native?.dispose();
    active.delete(key);
  }
}
