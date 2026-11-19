/**
 * Renderer side of the browser-panel passkey dialog. Main
 * (`features/passkeys/main/passkey-service.ts`) owns the ceremony and sends
 * the full dialog state; the renderer only draws it and sends the user's
 * answers back. Payload contract: `src/shared/ipc/passkeys.ts`.
 */
import { electronAPI } from '$lib/client/live/backend-transport';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { Logger } from '$shared/logger';
import type {
  PasskeyDialogClosePayload,
  PasskeyDialogResponse,
  PasskeyDialogShowPayload,
} from '$shared/ipc/passkeys';

const logger = new Logger('PasskeyDialog');
const CHANNELS = IPC_CHANNELS.PASSKEYS;

export interface PasskeyDialogHandlers {
  onShow: (payload: PasskeyDialogShowPayload) => void;
  onClose: (ceremonyId: string) => void;
}

/** Installs the dialog listeners; returns the disposer. */
export function installPasskeyDialogService(handlers: PasskeyDialogHandlers): () => void {
  const api = electronAPI();
  if (!api) return () => {};
  const showId = api.on(CHANNELS.DIALOG_SHOW, (payload: unknown) => {
    const show = payload as PasskeyDialogShowPayload | undefined;
    if (!show || typeof show.ceremonyId !== 'string' || !show.view) return;
    handlers.onShow(show);
  });
  const closeId = api.on(CHANNELS.DIALOG_CLOSE, (payload: unknown) => {
    const close = payload as PasskeyDialogClosePayload | undefined;
    if (close && typeof close.ceremonyId === 'string') handlers.onClose(close.ceremonyId);
  });
  return () => {
    api.offById(CHANNELS.DIALOG_SHOW, showId);
    api.offById(CHANNELS.DIALOG_CLOSE, closeId);
  };
}

export function respondToPasskeyDialog(response: PasskeyDialogResponse): void {
  const api = electronAPI();
  if (!api) return;
  void api.invoke(CHANNELS.DIALOG_RESPOND, response).catch(() => {
    logger.warn('Passkey dialog response failed', { action: response.action });
  });
}
