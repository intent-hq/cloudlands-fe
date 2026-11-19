/**
 * The one main-process opener for URLs Intent hands to the OS. Every path
 * converges here: the `shell:openExternal` IPC (and so the renderer's
 * openExternalUrl, terminal links, link-handler fallbacks, menu and help
 * links), webview navigation and popup handlers, and OAuth sign-ins.
 *
 * With INTENT_NO_SYSTEM_BROWSER=1 (Intent OS: no system browser), an http(s)
 * URL opens in a browser panel of the workspace that the focused (else most
 * recently focused) window shows, else in the sign-in window. Other URLs, and
 * every URL without the variable, go to `shell.openExternal`.
 */

import { BrowserWindow, shell } from 'electron';
import type { BrowserOpenLinkPayload } from '../shared/ipc/workspace-command-payloads';
import { IPC_CHANNELS } from '../shared/ipc-registry';
import { Logger } from '../shared/logger';
import { chooseInAppWebLinkTarget, isSystemBrowserDisabled, isWebUrl } from './web-link-routing';

// The in-app path loads the window, frame and sign-in modules on first use:
// they pull in most of main, which every caller of this opener (and its
// tests) would otherwise load just to reach `shell.openExternal`.

const logger = new Logger('OpenExternal');

/** Open `url` outside the app page: the system browser, or Intent's own browser on Intent OS. */
export async function openExternal(url: string): Promise<void> {
  if (isSystemBrowserDisabled() && isWebUrl(url)) {
    await openWebUrlInApp(url);
    return;
  }
  await shell.openExternal(url);
}

/**
 * A web page the OS sent to Intent (a second launch's `--open-url=`; Intent
 * OS routes xdg-open there): in-app like {@link openExternal} without a
 * system browser, else the sign-in window.
 */
export async function openWebUrlFromOs(url: string): Promise<void> {
  if (isSystemBrowserDisabled()) {
    await openWebUrlInApp(url);
    return;
  }
  const { openSignInWindow } = await import('../features/browser/main/sign-in-window');
  openSignInWindow(url);
}

async function openWebUrlInApp(url: string): Promise<void> {
  const { framesByRecentFocus, isFrame } = await import('./frames');
  const { getShownRendererWebContents } = await import('./window-backend');
  const { openSignInWindow } = await import('../features/browser/main/sign-in-window');
  const { getViewedWorkspaceId } = await import('../features/system/main/system.ipc');
  // Frames, the focused one first, then by most recent focus.
  const focused = BrowserWindow.getFocusedWindow();
  const recent = framesByRecentFocus();
  const frames: BrowserWindow[] =
    focused && isFrame(focused) ? [focused, ...recent.filter((f) => f !== focused)] : recent;
  const target = chooseInAppWebLinkTarget(
    frames.map((window) => ({ window, workspaceId: getViewedWorkspaceId(window) })),
  );
  if (target.kind === 'sign-in-window') {
    openSignInWindow(url);
    return;
  }
  const { window, workspaceId } = target;
  const payload: BrowserOpenLinkPayload = { workspaceId, url };
  try {
    getShownRendererWebContents(window).send(IPC_CHANNELS.BROWSER.OPEN_LINK, payload);
  } catch (error) {
    logger.warn('Failed to send web link to window; using sign-in window', { error });
    openSignInWindow(url);
    return;
  }
  if (window.isMinimized()) window.restore();
  window.focus();
}
