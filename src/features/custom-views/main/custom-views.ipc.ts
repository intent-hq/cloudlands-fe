import path from 'node:path';
import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import { isTrustedRendererUrl } from '../../../main/ipc-authorization';
import { customViewsChannels, type CustomViewsResponse } from '../../../shared/types/custom-views';
import { CustomViewsService } from './custom-views.service';

let service: CustomViewsService | undefined;

function trustedSender(event: IpcMainInvokeEvent): boolean {
  const sender = event?.sender;
  if (!sender || sender.isDestroyed() || sender.getType() !== 'window') return false;
  const owner = BrowserWindow.fromWebContents(sender);
  return (
    !!owner &&
    !owner.isDestroyed() &&
    owner.webContents === sender &&
    sender.session === session.defaultSession &&
    !!event.senderFrame &&
    event.senderFrame === sender.mainFrame &&
    isTrustedRendererUrl(event.senderFrame.url)
  );
}

export function setupCustomViewsIPC(
  instance = new CustomViewsService(path.join(app.getPath('userData'), 'custom-views.json')),
): void {
  service = instance;
  for (const action of ['list', 'save', 'remove', 'start', 'stop'] as const) {
    ipcMain.handle(
      customViewsChannels[action],
      (event, payload: unknown): Promise<CustomViewsResponse> | CustomViewsResponse => {
        // Even the development HTTP bridge must not run desktop-local commands.
        if (!trustedSender(event) || (action === 'list' && payload !== undefined)) {
          return {
            success: false,
            error: { code: 'invalid-input', message: 'Invalid custom view request.' },
          };
        }
        return action === 'list' ? instance.list() : instance[action](payload);
      },
    );
  }
}

export async function disposeCustomViews(): Promise<void> {
  await service?.dispose();
}
