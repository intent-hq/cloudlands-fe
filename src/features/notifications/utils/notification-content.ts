/**
 * Notification content builder — a PURE port of the main-process
 * `NotificationService.buildNotificationContent()` + specialist display-name
 * mapping (`src/features/notifications/main/notification.service.ts`), used by
 * the web-platform substitute (`web-notification-service.ts`).
 *
 * The main-process original fetches the workspace title itself (via the
 * main-only workspaceService); renderer code must not import from a feature's
 * `main/` subtree, so this util takes the pre-fetched `workspaceTitle` as an
 * argument and stays dependency-light (no stores, services, or side effects).
 * Keep the truncation limits and formats byte-identical to the main-process
 * builder so web notifications match Electron's title/body exactly.
 */

import { m } from '$shared/paraglide/messages.js';

/** Map specialist ID to display name (mirrors notification.service.ts). */
const SPECIALIST_DISPLAY_NAMES: Record<string, () => string> = {
  'spec-writer': () => m.notification_specialist_coordinator(),
  implementor: () => m.notification_specialist_implementor(),
  verifier: () => m.notification_specialist_verifier(),
};

/** Get display name for a specialist type (mirrors notification.service.ts). */
export function getSpecialistDisplayName(specialist?: string): string {
  if (!specialist) return m.notification_specialist_agent();
  return SPECIALIST_DISPLAY_NAMES[specialist]?.() || m.notification_specialist_agent();
}

/** Notification content for display. */
export interface NotificationContent {
  title: string;
  body: string;
}

/** Inputs distilled from an `agent:idle` event (see AgentIdleEvent.data). */
export interface NotificationContentInput {
  /** True when the event's workspace is the hidden chief virtual workspace. */
  isChief: boolean;
  /** Agent (chief: chat thread) name from the event payload. */
  agentName?: string;
  /** Specialist type, enriched from agent metadata when the payload lacks it. */
  specialist?: string;
  /** Title of the task note the agent was working on, if any. */
  taskTitle?: string;
}

/**
 * Build notification content from event data. Uses specialist display name
 * and task title instead of agent name — a pure mirror of the main-process
 * `buildNotificationContent`, with the workspace title pre-fetched by the
 * caller.
 */
export function buildNotificationContent(
  input: NotificationContentInput,
  workspaceTitle?: string,
): NotificationContent {
  const { isChief, agentName, specialist, taskTitle } = input;

  // Chief-of-staff completions: the chief "workspace" is a hidden virtual
  // workspace, so title with the chat thread name instead of
  // "<workspaceTitle> - <specialist>".
  if (isChief) {
    const chatName = agentName;
    const truncatedChatName =
      chatName && chatName.length > 40 ? `${chatName.slice(0, 37)}...` : chatName;
    return {
      title: truncatedChatName
        ? m.notification_assistant_titled({ chatName: truncatedChatName })
        : m.notification_assistant_title(),
      body: taskTitle ? m.notification_body_task_completed() : m.notification_body_finished(),
    };
  }

  // Get display name for the agent type
  const displayName = getSpecialistDisplayName(specialist);

  // Build title: include workspace name for context
  // Format: "WorkspaceName - Coordinator" or "WorkspaceName - Implementor: Task Title"
  let title = displayName;
  if (taskTitle) {
    // Truncate task title if too long for notification
    const truncatedTitle = taskTitle.length > 40 ? `${taskTitle.slice(0, 37)}...` : taskTitle;
    title = `${displayName}: ${truncatedTitle}`;
  }

  // Prepend workspace title if available
  if (workspaceTitle) {
    // Truncate workspace title if needed to keep notification readable
    const truncatedWorkspace =
      workspaceTitle.length > 30 ? `${workspaceTitle.slice(0, 27)}...` : workspaceTitle;
    title = `${truncatedWorkspace} - ${title}`;
  }

  // Build body
  const body = taskTitle ? m.notification_body_task_completed() : m.notification_body_finished();

  return { title, body };
}
