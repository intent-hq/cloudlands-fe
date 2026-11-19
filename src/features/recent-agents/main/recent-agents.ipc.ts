/**
 * Recent agents belong to the desktop app, not to one window or machine: main keeps one list
 * for every window, persists it in local prefs (never synced) and pushes the whole list to
 * every renderer after each change.
 */
import { app, ipcMain } from 'electron';
import { z } from 'zod';
import { getAppWindows } from '../../../main/offscreen-window';
import { RecentAgentVisitSchema, RecentAgentWorkspaceSchema } from '../../../main/ipc-schemas';
import { createValidatedHandler } from '../../../main/ipc-validation-middleware';
import { getLocalPref, setLocalPref } from '../../../main/local-prefs';
import { getRendererWebContents } from '../../../main/window-backend';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import {
  parseRecentAgents,
  recordRecentAgentVisit,
  removeRecentAgentWorkspace,
  type RecentAgentEntry,
  pageKeyToForward,
} from '../../../shared/recent-agents';

const RECENT_AGENTS = IPC_CHANNELS.RECENT_AGENTS;
const EmptySchema = z.object({}).optional();

let entries: RecentAgentEntry[] | null = null;
/** Changes apply one at a time, each to the list the previous one left. */
let queue: Promise<unknown> = Promise.resolve();

async function current(): Promise<RecentAgentEntry[]> {
  entries ??= parseRecentAgents(await getLocalPref('recentAgents'));
  return entries;
}

function broadcast(list: RecentAgentEntry[]): void {
  for (const window of getAppWindows()) {
    if (window.isDestroyed()) continue;
    for (const renderer of getRendererWebContents(window)) {
      if (!renderer.isDestroyed()) renderer.send(RECENT_AGENTS.CHANGED, list);
    }
  }
}

function change(
  apply: (list: RecentAgentEntry[]) => RecentAgentEntry[],
): Promise<RecentAgentEntry[]> {
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

export function setupRecentAgentsIPC(now: () => number = Date.now): void {
  ipcMain.handle(
    RECENT_AGENTS.LIST,
    createValidatedHandler(EmptySchema, async () => current(), RECENT_AGENTS.LIST),
  );
  ipcMain.handle(
    RECENT_AGENTS.RECORD,
    createValidatedHandler(
      RecentAgentVisitSchema,
      async (_event, visit) =>
        change((list) => recordRecentAgentVisit(list, { ...visit, visitedAt: now() })),
      RECENT_AGENTS.RECORD,
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
}

/**
 * Keys typed in a `<webview>` never reach the app's document, so main forwards the switcher's
 * chord to the page's host renderer. The switcher then takes focus, and later keys reach it
 * directly; the modifier release is forwarded too in case it lands in the page first.
 */
export function setupRecentAgentPageKeys(): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;
    let chordOpen = false;
    contents.on('before-input-event', (event, input) => {
      const forward = pageKeyToForward(input, chordOpen);
      if (!forward) return;
      const host = contents.hostWebContents;
      if (!host || host.isDestroyed()) return;
      chordOpen = forward.type === 'keydown';
      if (forward.type === 'keydown') event.preventDefault();
      host.send(RECENT_AGENTS.PAGE_KEY, forward);
    });
  });
}
