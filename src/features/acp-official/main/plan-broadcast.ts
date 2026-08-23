/**
 * Native ACP plan broadcaster (monorepo#3249).
 *
 * `planManager` is a per-process module singleton and only the main process
 * ever calls `updatePlan` (acp-server.ts). Electron process isolation means
 * the renderer's own module instance never fires, so `plan:updated` /
 * `plan:cleared` are forwarded here over IPC for the renderer's `nativePlans`
 * slice (the source-priority gate for the fallback plan card).
 */
import { BrowserWindow } from 'electron';
import { planManager, type SessionPlan } from '../plans/plan-manager';

let registered = false;

function broadcast(channel: 'acp:plan-updated' | 'acp:plan-cleared', payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send(channel, payload);
  }
}

/**
 * Subscribe (once) to planManager events and forward them to every renderer
 * window. Idempotent: repeat calls (one per ACPServer construction) no-op.
 */
export function registerPlanBroadcaster(): void {
  if (registered) return;
  registered = true;
  planManager.on('plan:updated', (plan: SessionPlan) => {
    broadcast('acp:plan-updated', {
      sessionId: String(plan.sessionId),
      entries: plan.entries,
    });
  });
  planManager.on('plan:cleared', (sessionId: unknown) => {
    broadcast('acp:plan-cleared', { sessionId: String(sessionId) });
  });
}
