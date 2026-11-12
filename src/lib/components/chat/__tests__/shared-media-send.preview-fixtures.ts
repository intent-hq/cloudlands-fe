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

/** Exercise the real adapter's default invoke with no preload or a sentinel bridge. */
export async function probeUnavailableMediaAdapter(
  mode: string,
  media: import('$shared/dock-media-edit').DockSavedMedia,
) {
  const original = window.electronAPI;
  const { createChatMediaNative } = await import('$features/hud/composer/chat-media-native');
  if (mode === 'missing-preload') delete (window as { electronAPI?: unknown }).electronAPI;
  else
    window.electronAPI = {
      ...original!,
      versions: { ...original!.versions, electron: '0.0.0-browser' },
    };
  const adapter = createChatMediaNative(
    {
      workspaceId: 'synthetic',
      agentId: 'synthetic',
      draftId: crypto.randomUUID(),
      principalId: 'synthetic',
      media: [media],
    },
    () => true,
    new AbortController().signal,
  );
  const errors: string[] = [];
  try {
    const { exportMedia, transcribeMedia } = adapter.service;
    if (!exportMedia || !transcribeMedia) throw new Error('fixture-adapter-method-missing');
    for (const run of [
      () =>
        exportMedia({
          outputVersion: 2,
          jobId: crypto.randomUUID(),
          media,
          layers: [],
        }),
      () => transcribeMedia({ jobId: crypto.randomUUID(), media }),
    ]) {
      try {
        await run();
        errors.push('unexpected-success');
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return errors;
  } finally {
    await adapter.dispose();
    window.electronAPI = original;
  }
}
