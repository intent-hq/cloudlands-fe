/**
 * Per-window queue of renderer-bound deep-link actions.
 *
 * The main process never pushes a deep-link action straight into a renderer:
 * a window that is still loading (cold start, a just-restored session, a new
 * `newWindow=true` window) has no listener yet and would drop it. Instead the
 * action is queued for the target window and the window is nudged over the
 * `deep-link` channel. The renderer's deep-links saga pulls its own window's
 * queue through `deep-link:consume-pending` when it starts and on every nudge,
 * so each action is delivered exactly once whatever the load timing.
 */

import type { BrowserWindow, WebContents } from 'electron';
import type { DeepLinkAction } from '../deep-link-handler';
import { getShownRendererWebContents } from '../../../main/window-backend';

/** Payload of the `deep-link` nudge: "your window has queued actions". */
const DEEP_LINK_NUDGE = Object.freeze({ pending: true });

const queues = new Map<number, DeepLinkAction[]>();

function queueFor(webContents: WebContents): DeepLinkAction[] {
  let queue = queues.get(webContents.id);
  if (!queue) {
    queue = [];
    queues.set(webContents.id, queue);
    const id = webContents.id;
    webContents.once?.('destroyed', () => queues.delete(id));
  }
  return queue;
}

/**
 * Queue `action` for the renderer `window` shows (a frame's shown machine
 * view) and nudge it. Does not focus.
 */
export function queueDeepLinkForWindow(window: BrowserWindow, action: DeepLinkAction): void {
  queueDeepLinkForRenderer(getShownRendererWebContents(window), action);
}

/** Queue for the exact backend renderer, including machine views. Does not focus. */
export function queueDeepLinkForRenderer(contents: WebContents, action: DeepLinkAction): void {
  queueFor(contents).push(action);
  // A renderer that is not listening yet ignores the nudge; it drains the
  // queue on startup instead.
  contents.send('deep-link', DEEP_LINK_NUDGE);
}

/** Where a notification click goes: a workspace, or (chief) the Assistant thread. */
export interface NotificationNavigation {
  workspaceId: string;
  chief?: boolean;
  agentId?: string;
}

/**
 * Deliver a notification click's navigation to `contents`. A renderer that
 * reported ready gets it pushed; one that did not (still starting past the
 * wait) gets it queued, and pulls it once its deep-links saga starts.
 */
export function deliverNotificationNavigation(
  contents: WebContents,
  ready: boolean,
  navigation: NotificationNavigation,
): void {
  if (contents.isDestroyed()) return;
  if (ready) {
    contents.send('notification:navigate', navigation);
    return;
  }
  queueDeepLinkForRenderer(contents, notificationDeepLink(navigation));
}

/** A notification click's navigation as a deep link the renderer pulls from its queue. */
export function notificationDeepLink(navigation: NotificationNavigation): DeepLinkAction {
  return {
    type: 'notification',
    params: {
      workspaceId: navigation.workspaceId,
      ...(navigation.chief ? { chief: 'true' } : {}),
      ...(navigation.agentId ? { agentId: navigation.agentId } : {}),
    },
  };
}

/**
 * Take and clear the actions queued for the renderer behind `webContentsId`.
 * With `types`, only actions of those types are taken; the rest stay queued
 * (the renderer takes desktop-only `settings` links before the daemon has
 * admitted it, and the rest once it has). `remaining` counts what is left.
 */
export function consumePendingDeepLinks(
  webContentsId: number,
  types?: readonly string[],
): { actions: DeepLinkAction[]; remaining: number } {
  const queue = queues.get(webContentsId) ?? [];
  const taken = types ? queue.filter((action) => types.includes(action.type)) : queue;
  const left = types ? queue.filter((action) => !types.includes(action.type)) : [];
  if (queue.length > 0) queues.set(webContentsId, left);
  return { actions: taken, remaining: left.length };
}

export function __resetPendingDeepLinksForTesting(): void {
  queues.clear();
}
