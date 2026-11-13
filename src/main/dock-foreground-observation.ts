import { webContents } from 'electron';
import { getDockWindow } from './dock-window';
import { foregroundDocumentUrl, sampleDockForeground } from './dock-shortcut-foreground';
import { getDesktopNativeAdapter } from '../features/desktop/main/desktop-native';
import { dockServiceAddress } from '../features/browser/main/browser.ipc';
import { embeddedBrowserCdp } from '../features/browser/main/embedded-browser-cdp-service';
import type { DockForegroundObservation } from '../shared/dock-context-links';

let reading: ReturnType<typeof sampleDockForeground> | null = null;
/** Shared native reader for feed and shortcuts, always sampled before focus changes. */
export async function readDockForegroundObservation(
  backendId: string,
  fresh = false,
): Promise<Omit<DockForegroundObservation, 'contextVersion' | 'sequence'>> {
  if (fresh && reading) await reading;
  const focused = webContents.getFocusedWebContents();
  const before =
    focused && !focused.isDestroyed() ? embeddedBrowserCdp.focusedTabOwner(focused.id) : null;
  if (!reading)
    reading = sampleDockForeground(getDesktopNativeAdapter()).finally(() => {
      reading = null;
    });
  const { snapshot: sample } = await reading;
  let url: string | null = foregroundDocumentUrl(sample.url, sample.appId);
  // Native window titles are document labels only when that read verified a document URL.
  // Intent's own browser must instead pass the focused embedded-tab ownership check below.
  let tabTitle = sample.pid !== process.pid && url ? sample.title?.trim() || null : null;
  let workspaceId: string | undefined;
  let tabId: string | undefined;
  if (
    sample.pid === process.pid &&
    focused &&
    !focused.isDestroyed() &&
    webContents.getFocusedWebContents() === focused
  ) {
    const owner = embeddedBrowserCdp.focusedTabOwner(focused.id);
    if (
      owner?.backendId === backendId &&
      owner.workspaceId === before?.workspaceId &&
      owner.url === before.url &&
      owner.tabId === before.tabId
    ) {
      url = owner.url;
      workspaceId = owner.workspaceId;
      tabId = owner.tabId;
      tabTitle = foregroundDocumentUrl(owner.url) ? focused.getTitle().trim() || null : null;
    }
  }
  if (url && !workspaceId) {
    const owners = embeddedBrowserCdp.liveUrlOwners(url, backendId);
    if (owners.length === 1) workspaceId = owners[0];
  }
  const identityKind = tabId ? 'tab' : url ? 'url' : sample.appId ? 'app' : 'unknown';
  return {
    backendId,
    self: sample.pid === process.pid && !!focused && focused === getDockWindow()?.webContents,
    identityKey: tabId
      ? `tab:${tabId}`
      : url
        ? `url:${JSON.stringify([sample.appId ?? null, url])}`
        : sample.appId
          ? `app:${sample.appId}`
          : 'unknown',
    identityKind,
    appId: sample.appId ?? null,
    appName: sample.appName ?? null,
    tabTitle,
    url: url ?? null,
    icon: null,
    ...(workspaceId ? { workspaceId } : {}),
    ...(url ? { serviceAddress: dockServiceAddress(url, backendId) } : {}),
  };
}
