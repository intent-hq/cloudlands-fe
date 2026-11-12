/** Synthetic backend boundary used only by the shared media browser fixture. */
import { appClient } from '$lib/client';
import type { PreparedChatDraftCapture } from '$features/agent/prepare-chat-submission';
export async function persistSyntheticDraft(value: PreparedChatDraftCapture): Promise<void> {
  await appClient.drafts.set(value.workspaceId, value.agentId, value.text, value.attachments);
}
export function invokeFixtureBridge(
  bridge: NonNullable<Window['electronAPI']>,
  channel: string,
  payload: unknown,
) {
  return bridge.invoke(channel, payload);
}
