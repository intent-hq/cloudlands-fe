import { app, clipboard, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from '../../../main/window-backend';
import {
  SourceClipboardBeginSchema,
  SourceClipboardWriteSchema,
  SourceClipboardCommitSchema,
  SourceClipboardAbortSchema,
} from '../../../shared/ipc/source-clipboard';
import { getBackendClientForIpcEvent } from '../../backend/main/backend.ipc';
import { Logger } from '../../../shared/logger';
import {
  createSourceClipboard,
  SourceClipboardError,
  type SourceClipboardOwner,
} from './source-clipboard';

const logger = new Logger('SourceClipboard');
const channels = IPC_CHANNELS.SYSTEM;
// This bounds admitted main-process staging-to-native estimates, not the OS clipboard.
const NATIVE_ADMISSION_BYTES = 256 * 1024 * 1024;
let service: ReturnType<typeof createSourceClipboard> | undefined;
function getService() {
  return (service ??= createSourceClipboard({
    directory: app.getPath('temp'),
    maxNativeBytes: NATIVE_ADMISSION_BYTES,
    publish: (text) => clipboard.writeText(text),
    cleanupError: (error) => logger.error('Source clipboard private cleanup failed', { error }),
  }));
}
function owner(event: IpcMainInvokeEvent): SourceClipboardOwner {
  const sender = event.sender;
  if (
    !sender ||
    sender.isDestroyed() ||
    !event.senderFrame ||
    event.senderFrame !== sender.mainFrame
  )
    throw new SourceClipboardError('SOURCE_CLIPBOARD_OWNER');
  const binding = getStrictBackendBindingForWebContents(sender);
  if (!binding || binding.frame !== event.senderFrame)
    throw new SourceClipboardError('SOURCE_CLIPBOARD_OWNER');
  const { backendId, client } = getBackendClientForIpcEvent(event);
  if (backendId !== binding.backendId) throw new SourceClipboardError('SOURCE_CLIPBOARD_OWNER');
  let revoked = false;
  return {
    key: sender,
    current: () => {
      try {
        const current = getBackendClientForIpcEvent(event);
        revoked ||=
          sender.isDestroyed() ||
          getStrictBackendBindingForWebContents(sender) !== binding ||
          current.backendId !== backendId ||
          current.client !== client ||
          client.getStatus() !== 'connected';
      } catch {
        revoked = true;
      }
      return !revoked;
    },
    subscribe: (revoke) => {
      const lost = () => {
        revoked = true;
        revoke();
      };
      const status = (value: string) => {
        if (value !== 'connected') lost();
      };
      const unsubscribe = onStrictBackendBindingRetired(sender, lost);
      client.on('status', status);
      return () => {
        unsubscribe();
        client.removeListener('status', status);
      };
    },
  };
}
async function response<T>(action: () => Promise<T>) {
  try {
    return { success: true as const, data: await action() };
  } catch (error) {
    return {
      success: false as const,
      error: {
        code: error instanceof SourceClipboardError ? error.code : 'SOURCE_CLIPBOARD_IO',
      },
    };
  }
}
/** No renderer paths, backend selectors, or public file destinations are accepted. */
export function registerSourceClipboardIPC() {
  ipcMain.handle(
    channels.SOURCE_CLIPBOARD_BEGIN,
    createSafeValidatedHandler(
      SourceClipboardBeginSchema,
      (event, p) => response(() => getService().begin(owner(event), p)),
      channels.SOURCE_CLIPBOARD_BEGIN,
    ),
  );
  ipcMain.handle(
    channels.SOURCE_CLIPBOARD_WRITE,
    createSafeValidatedHandler(
      SourceClipboardWriteSchema,
      (event, p) => response(() => getService().write(owner(event), p)),
      channels.SOURCE_CLIPBOARD_WRITE,
    ),
  );
  ipcMain.handle(
    channels.SOURCE_CLIPBOARD_COMMIT,
    createSafeValidatedHandler(
      SourceClipboardCommitSchema,
      (event, p) => response(() => getService().commit(owner(event), p)),
      channels.SOURCE_CLIPBOARD_COMMIT,
    ),
  );
  ipcMain.handle(
    channels.SOURCE_CLIPBOARD_ABORT,
    createSafeValidatedHandler(
      SourceClipboardAbortSchema,
      (event, p) =>
        response(async () => {
          await getService().abort(owner(event), p);
          return { aborted: true };
        }),
      channels.SOURCE_CLIPBOARD_ABORT,
    ),
  );
}
