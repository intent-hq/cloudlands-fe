import { BrowserWindow, type WebContents } from 'electron';
import { isChatWindow } from './chat-window-identity';
import { getMainWindow } from './state';
import { getShownRendererWebContents } from './window-backend';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';

export function getInviteWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && isChatWindow(focused)) return focused;
  const main = getMainWindow();
  if (main && isChatWindow(main)) return main;
  return BrowserWindow.getAllWindows().find(isChatWindow) ?? null;
}

let openingWindow: Promise<BrowserWindow | null> | null = null;

function waitForDocument(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed()) return Promise.resolve(false);
  if (!contents.isLoadingMainFrame()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      contents.removeListener('did-stop-loading', loaded);
      contents.removeListener('did-fail-load', failed);
      contents.removeListener('destroyed', gone);
      contents.removeListener('render-process-gone', gone);
      resolve(ready);
    };
    const loaded = () => finish(true);
    const gone = () => finish(false);
    const failed = (
      _event: Electron.Event,
      _code: number,
      _description: string,
      _url: string,
      isMainFrame: boolean,
    ) => {
      if (isMainFrame) finish(false);
    };
    const timer = setTimeout(gone, 5 * 60_000);
    contents.once('did-stop-loading', loaded);
    contents.on('did-fail-load', failed);
    contents.once('destroyed', gone);
    contents.once('render-process-gone', gone);
  });
}

export async function focusInviteWindow(): Promise<BrowserWindow | null> {
  let window = getInviteWindow();
  if (!window) {
    openingWindow ??= import('./window')
      .then(async ({ createWindow }) => {
        await createWindow(LOCAL_CONNECTION_ID);
        return getInviteWindow();
      })
      .finally(() => {
        openingWindow = null;
      });
    window = await openingWindow;
  }
  if (!window || !isChatWindow(window)) return null;
  const contents = getShownRendererWebContents(window);
  const ready = await waitForDocument(contents);
  if (!ready || !isChatWindow(window) || getShownRendererWebContents(window) !== contents)
    return null;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}
