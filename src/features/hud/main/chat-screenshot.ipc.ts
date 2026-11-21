import { ipcMain, screen, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { DOCK_CAPTURE_MODES } from '../../../shared/dock-evidence';
import { isChatWindow } from '../../../main/chat-window-identity';
import { createAuthorizedIpcHandler, isTrustedRendererUrl } from '../../../main/ipc-authorization';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from '../../../main/window-backend';
import { dockEvidenceSessions } from './dock-evidence-session';

const requestSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('capture'), requestId: z.guid(), mode: z.enum(DOCK_CAPTURE_MODES) })
    .strict(),
  z.object({ action: z.literal('cancel'), requestId: z.guid() }).strict(),
]);
const unavailable = { ok: false, error: 'unavailable' } as const;

export function setupChatScreenshotIPC(): void {
  const channel = IPC_CHANNELS.CHAT_SCREENSHOT.CONTROL;
  const pending = new Map<
    Electron.WebContents,
    {
      requestId: string;
      frame: Electron.WebFrameMain;
      aborter: AbortController;
    }
  >();

  ipcMain.handle(
    channel,
    createAuthorizedIpcHandler(channel, async (event: IpcMainInvokeEvent, input: unknown) => {
      const parsed = requestSchema.safeParse(input);
      const { sender, senderFrame: frame } = event;
      const binding = getStrictBackendBindingForWebContents(sender);
      if (
        !parsed.success ||
        !frame ||
        !binding ||
        binding.frame !== frame ||
        !isChatWindow(binding.window)
      )
        return unavailable;

      const { window } = binding;
      const request = parsed.data;
      const previous = pending.get(sender);
      if (request.action === 'cancel') {
        if (previous?.requestId === request.requestId && previous.frame === frame)
          previous.aborter.abort();
        return;
      }
      if (previous || !window.isFocused()) return unavailable;

      const aborter = new AbortController();
      const stopWatching = onStrictBackendBindingRetired(sender, () => aborter.abort());
      pending.set(sender, { requestId: request.requestId, frame, aborter });
      try {
        const display = screen.getDisplayMatching(window.getBounds());
        const result = await dockEvidenceSessions.captureForChat(
          display,
          request.mode,
          aborter.signal,
        );
        if (
          aborter.signal.aborted ||
          sender.isDestroyed() ||
          sender.mainFrame !== frame ||
          !isTrustedRendererUrl(frame.url) ||
          getStrictBackendBindingForWebContents(sender) !== binding
        )
          return unavailable;
        return result;
      } finally {
        pending.delete(sender);
        stopWatching();
      }
    }),
  );
}
