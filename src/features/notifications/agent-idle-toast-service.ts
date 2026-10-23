/**
 * Agent-idle in-app toast — the renderer half of the main process's
 * frontmost gate (`notification.service.ts`): while the app is frontmost the
 * OS banner is skipped (electron#51885 — foreground banner clicks never
 * fire) and `notification:show` arrives carrying a `navigateTarget`. This
 * service turns that payload into a transient toast naming who finished and
 * where, with a "Switch To" action. Without it the user hears the
 * notification sound with nothing on screen.
 *
 * Suppression: skipped (sound still plays — the saga owns the sound gate)
 * when THIS window is focused and its current workspace tab is the target —
 * the same "already selected" rule as the attention/failure toasts. The
 * focus check matters because `notification:show` is delivered to every
 * window with the workspace open: an unfocused window parked on it must not
 * swallow the toast. Assistant (chief) payloads are never suppressed — the
 * chief workspace is never a selected tab.
 *
 * The toast id is stable per workspace (per Assistant chat for chief) so a
 * burst of idles updates one toast in place instead of stacking.
 *
 * Dependency-light like `agent-attention-toast-service.ts`: the toast lib,
 * component, key-slot resolver, and navigation helpers load lazily.
 */
import type { NotificationNavigatePayload } from './notification-navigation';
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';

const logger = createLogger('AgentIdleToastService');

/** Structured parts of `notification:show` (see notification.service.ts in main). */
interface AgentIdleToastStructured {
  workspaceTitle?: string;
  specialist?: string;
  specialistDisplayName: string;
  taskTitle?: string;
  provider?: string;
  agentId?: string;
  agentName?: string;
}

/** Payload of `notification:show` (see notification.service.ts in main). */
export interface AgentIdleToastPayload {
  title?: string;
  body?: string;
  timestamp?: string;
  /** Present only when main skipped the OS banner because the app was frontmost. */
  navigateTarget?: NotificationNavigatePayload;
  /** Absent for Assistant (chief) notifications and older main builds. */
  structured?: AgentIdleToastStructured;
}

function isChiefTarget(target: NotificationNavigatePayload): boolean {
  return target.chief === true || target.workspaceId === CHIEF_WORKSPACE_ID;
}

/** Stable toast id: one per workspace, one per Assistant chat. */
export function agentIdleToastId(target: NotificationNavigatePayload): string {
  return isChiefTarget(target)
    ? `agent-idle:${target.workspaceId}:${target.agentId ?? ''}`
    : `agent-idle:${target.workspaceId}`;
}

/** True when this focused window already has the target workspace selected. */
function isToastRedundant(target: NotificationNavigatePayload): boolean {
  if (!target.workspaceId || isChiefTarget(target)) return false;
  if (typeof document === 'undefined' || !document.hasFocus()) return false;
  return appStore.state.tabState?.currentTabId === target.workspaceId;
}

async function resolveKeySlot(workspaceId: string): Promise<number | null> {
  try {
    const { resolveConnectedWorkspaceKeySlot } =
      await import('$features/hardware-console/assignment/connected-key-slot');
    return resolveConnectedWorkspaceKeySlot(workspaceId);
  } catch (error) {
    logger.warn('Key-slot resolution failed — toast renders without badge', { error });
    return null;
  }
}

/**
 * "Switch To": open the agent's conversation in its workspace when the
 * agent is known (same routing as the attention toast), else route like a
 * native notification click (Assistant panel for chief payloads).
 */
async function switchTo(target: NotificationNavigatePayload, agentId?: string): Promise<void> {
  if (!isChiefTarget(target) && target.workspaceId && agentId) {
    const { switchToAttentionAgent } =
      await import('$features/agent/agent-attention-toast-service');
    await switchToAttentionAgent(target.workspaceId, agentId);
    return;
  }
  const { handleNotificationNavigate } = await import('./notification-navigation');
  await handleNotificationNavigate(target);
}

/**
 * Show (or update in place) the transient agent-finished toast for a
 * frontmost `notification:show` payload. No-op without a `navigateTarget`
 * (sound-only delivery) or when the toast would be redundant. Never rejects.
 */
export async function showAgentIdleToast(payload: AgentIdleToastPayload): Promise<void> {
  const target = payload.navigateTarget;
  const workspaceId = target?.workspaceId;
  if (!target || !workspaceId || isToastRedundant(target)) return;
  try {
    const chief = isChiefTarget(target);
    const [{ notify }, { AgentIdleToast }, keySlot] = await Promise.all([
      import('$lib/components/patterns/notify'),
      import('$lib/components/ui/toast'),
      chief ? Promise.resolve(null) : resolveKeySlot(workspaceId),
    ]);
    if (isToastRedundant(target)) return;
    const structured = payload.structured;
    const name = structured?.agentName || structured?.specialistDisplayName;
    const title =
      !chief && name
        ? m.notifications_idleToast_title({ name })
        : (payload.title ?? payload.body ?? '');
    const id = agentIdleToastId(target);
    const agentId = structured?.agentId ?? target.agentId;
    notify.custom(AgentIdleToast, {
      id,
      componentProps: {
        title,
        workspaceTitle: chief ? undefined : structured?.workspaceTitle,
        description: structured?.taskTitle ?? (payload.title ? payload.body : undefined),
        timestamp: payload.timestamp,
        keySlot,
        onSwitchTo: () => {
          notify.dismiss(id);
          void switchTo(target, agentId).catch((error) =>
            logger.warn('Switch To from idle toast failed', { workspaceId, error }),
          );
        },
        onClose: () => notify.dismiss(id),
      },
    });
  } catch (error) {
    logger.warn('Failed to show agent idle toast', { workspaceId, error });
  }
}
