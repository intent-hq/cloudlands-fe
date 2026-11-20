/**
 * Recent agents (with browser and terminal tabs) belong to the desktop app, not to one window or machine: main keeps one list
 * for every window, persists it in local prefs (never synced) and pushes the whole list to
 * every renderer after each change.
 */
import { app, ipcMain } from 'electron';
import { z } from 'zod';
import { getAppWindows } from '../../../main/offscreen-window';
import {
  RecentAgentPageChordSchema,
  RecentAgentVisitSchema,
  RecentAgentWorkspaceSchema,
  RecentEntryKeySchema,
} from '../../../main/ipc-schemas';
import { createValidatedHandler } from '../../../main/ipc-validation-middleware';
import { getLocalPref, setLocalPref } from '../../../main/local-prefs';
import {
  getRendererWebContents,
  getWindowForWebContents,
  isShownRenderer,
} from '../../../main/window-backend';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { shortcutDefault } from '../../../shared/keyboard-shortcut-bindings';
import {
  parseRecentAgents,
  recordRecentVisit,
  removeRecentAgentWorkspace,
  removeRecentEntry,
  type RecentEntry,
  pageKeyToForward,
} from '../../../shared/recent-agents';

const RECENT_AGENTS = IPC_CHANNELS.RECENT_AGENTS;
const EmptySchema = z.object({}).optional();

let entries: RecentEntry[] | null = null;
/** The switcher chord browser-panel pages forward; renderers report the user's binding. */
let pageChord = shortcutDefault('navigation.recent-agents');
/** Changes apply one at a time, each to the list the previous one left. */
let queue: Promise<unknown> = Promise.resolve();

async function current(): Promise<RecentEntry[]> {
  entries ??= parseRecentAgents(await getLocalPref('recentAgents'));
  return entries;
}

function broadcast(list: RecentEntry[]): void {
  for (const window of getAppWindows()) {
    if (window.isDestroyed()) continue;
    for (const renderer of getRendererWebContents(window)) {
      if (!renderer.isDestroyed()) renderer.send(RECENT_AGENTS.CHANGED, list);
    }
  }
}

function change(apply: (list: RecentEntry[]) => RecentEntry[]): Promise<RecentEntry[]> {
  const run = queue.then(async () => {
    const before = await current();
    const next = apply(before);
    if (next === before) return before;
    entries = next;
    await setLocalPref('recentAgents', next);
    broadcast(next);
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

/**
 * Background windows restoring a layout also bring chats on screen; only the window in use
 * records them. A renderer's `document.hasFocus()` cannot tell: it stays false in a machine
 * view under some Linux compositors, the Intent OS kiosk among them, so main decides.
 */
function isWindowInUse(sender: Electron.WebContents): boolean {
  const window = getWindowForWebContents(sender);
  if (!window || !isShownRenderer(window, sender)) return false;
  return window.isFocused() || getAppWindows().length === 1;
}

export function setupRecentAgentsIPC(now: () => number = Date.now): void {
  ipcMain.handle(
    RECENT_AGENTS.LIST,
    createValidatedHandler(EmptySchema, async () => current(), RECENT_AGENTS.LIST),
  );
  ipcMain.handle(
    RECENT_AGENTS.RECORD,
    createValidatedHandler(
      RecentAgentVisitSchema,
      async (event, { viewed, ...visit }) => {
        if (viewed && !isWindowInUse(event.sender)) return current();
        return change((list) => recordRecentVisit(list, { ...visit, visitedAt: now() }));
      },
      RECENT_AGENTS.RECORD,
    ),
  );
  ipcMain.handle(
    RECENT_AGENTS.SET_PAGE_CHORD,
    createValidatedHandler(
      RecentAgentPageChordSchema,
      async (_event, { binding }) => {
        pageChord = binding;
        return { ok: true };
      },
      RECENT_AGENTS.SET_PAGE_CHORD,
    ),
  );
  ipcMain.handle(
    RECENT_AGENTS.FORGET_WORKSPACE,
    createValidatedHandler(
      RecentAgentWorkspaceSchema,
      async (_event, { connectionId, workspaceId }) =>
        change((list) => {
          const next = removeRecentAgentWorkspace(list, connectionId, workspaceId);
          return next.length === list.length ? list : next;
        }),
      RECENT_AGENTS.FORGET_WORKSPACE,
    ),
  );
  ipcMain.handle(
    RECENT_AGENTS.FORGET_ENTRY,
    createValidatedHandler(
      RecentEntryKeySchema,
      async (_event, { key }) =>
        change((list) => {
          const next = removeRecentEntry(list, key);
          return next.length === list.length ? list : next;
        }),
      RECENT_AGENTS.FORGET_ENTRY,
    ),
  );
}

/**
 * Keys typed in a `<webview>` never reach the app's document, so main forwards the switcher's
 * chord (the binding a renderer last reported) to the page's host renderer. The switcher then takes focus, and later keys reach it
 * directly; the modifier release is forwarded too in case it lands in the page first.
 */
export function setupRecentAgentPageKeys(): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;
    let chordOpen = false;
    contents.on('before-input-event', (event, input) => {
      const forward = pageKeyToForward(input, chordOpen, pageChord, process.platform === 'darwin');
      if (!forward) return;
      const host = contents.hostWebContents;
      if (!host || host.isDestroyed()) return;
      chordOpen = forward.type === 'keydown';
      if (forward.type === 'keydown') event.preventDefault();
      host.send(RECENT_AGENTS.PAGE_KEY, forward);
    });
  });
}
