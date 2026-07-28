/**
 * Event Notification Formatter
 *
 * Formats workspace events into human-readable notifications for agents.
 * These notifications are injected into agent conversations when they become idle.
 */

import {
  WorkspaceEvent,
  isAgentCreatedEvent,
  isAgentDeletedEvent,
  isAgentIdleEvent,
  isAgentMessageSentEvent,
  isAgentMessageReceivedEvent,
  isFileChangedEvent,
  isTaskStatusChangedEvent,
  isNoteChangedEvent,
  isAgentToolCallEvent,
} from '../types';

/**
 * Convert action to proper past tense
 */
function getActionPastTense(action: string): string {
  const pastTenseMap: Record<string, string> = {
    create: 'created',
    modify: 'modified',
    delete: 'deleted',
    rename: 'renamed',
  };
  return pastTenseMap[action.toLowerCase()] || `${action}ed`;
}

/**
 * Format a batch of events into a notification message for an agent
 */
export function formatEventNotification(events: WorkspaceEvent[]): string {
  if (events.length === 0) {
    return '';
  }

  const lines: string[] = [
    '[WORKSPACE EVENTS]',
    // i18n-ignore (agent-facing notification content)
    `You have received ${events.length} workspace event${events.length > 1 ? 's' : ''} while you were working:`,
    '',
  ];

  // Group events by type for better readability
  const grouped = groupEventsByType(events);

  let eventNumber = 1;

  for (const [_type, typeEvents] of Object.entries(grouped)) {
    for (const event of typeEvents) {
      lines.push(`${eventNumber}. ${formatSingleEvent(event)}`);
      eventNumber++;
    }
  }

  lines.push('');
  // i18n-ignore (agent-facing notification content)
  lines.push('Consider these events and take appropriate action if needed.');

  return lines.join('\n');
}

/**
 * Format a single event into a readable string
 */
export function formatSingleEvent(event: WorkspaceEvent): string {
  const timestamp = new Date(event.timestamp).toLocaleTimeString();

  // Agent created
  if (isAgentCreatedEvent(event)) {
    const { agentName, agentId, taskNoteId, createdByAgentId } = event.data;
    // i18n-ignore (agent-facing notification content)
    const displayName = agentName || 'New agent';
    let msg = `[agent:created] "${displayName}" was created`;
    if (agentId) {
      msg += ` {{agentId:${agentId}}}`;
    }
    if (createdByAgentId) {
      msg += ' by another agent';
    }
    if (taskNoteId) {
      msg += '\n   - Assigned to a task';
    }
    return msg;
  }

  // Agent deleted
  if (isAgentDeletedEvent(event)) {
    const { agentName, agentId, taskNoteId, reason } = event.data;
    const displayName = agentName || 'Agent';
    let msg = `[agent:deleted] "${displayName}" was deleted`;
    if (agentId) {
      msg += ` {{agentId:${agentId}}}`;
    }
    if (taskNoteId) {
      msg += `\n   - Was working on task: ${taskNoteId}`;
    }
    if (reason && reason !== 'user_action') {
      msg += `\n   - Reason: ${reason}`;
    }
    // i18n-ignore (agent-facing notification content)
    msg += '\n\n   This agent is no longer available. Its conversation history has been removed.';
    return msg;
  }

  // Agent idle (completed responding)
  if (isAgentIdleEvent(event)) {
    const { agentName, agentId, messageCount, lastResponseSummary, taskNoteId, completionReport } =
      event.data;
    const displayName = agentName || 'Agent';
    // Include agentId in a data attribute format for parsing
    let msg = `[agent:idle] "${displayName}" finished responding`;
    if (agentId) {
      msg += ` {{agentId:${agentId}}}`;
    }
    if (taskNoteId) {
      msg += `\n   - Task: ${taskNoteId}`;
    }
    if (messageCount !== undefined && messageCount !== null) {
      msg += `\n   - ${messageCount} message${messageCount !== 1 ? 's' : ''} in conversation`;
    }

    // If there's an explicit completion report, show it prominently
    if (completionReport) {
      msg += `\n\n   📋 **Completion Report from "${displayName}":**\n   ${completionReport.split('\n').join('\n   ')}`;
    } else if (lastResponseSummary) {
      // Fall back to auto-generated summary if no explicit report
      msg += `\n\n   **Agent's Summary:**\n   ${lastResponseSummary.split('\n').join('\n   ')}`;
    }

    // i18n-ignore (agent-facing notification content)
    msg += `\n\n   Use \`read_agent_conversation(agentId="${agentId}")\` to see their full conversation.`;
    return msg;
  }

  // Agent message sent
  if (isAgentMessageSentEvent(event)) {
    const { fromAgentName, toAgentName, message, priority } = event.data;
    const preview = message.length > 100 ? `${message.substring(0, 100)}...` : message;
    const prioritySuffix =
      priority === 'interrupt' ? ' (INTERRUPT)' : priority === 'high' ? ' (HIGH PRIORITY)' : '';
    return `[agent:message:sent] "${fromAgentName}" sent message to "${toAgentName}"${prioritySuffix}\n   - Message: "${preview}"`;
  }

  // Agent message received
  if (isAgentMessageReceivedEvent(event)) {
    const { fromAgentName, message, wasQueued } = event.data;
    const preview = message.length > 100 ? `${message.substring(0, 100)}...` : message;
    return `[agent:message:received] Message from "${fromAgentName}"${wasQueued ? ' (was queued)' : ''}\n   - Message: "${preview}"`;
  }

  // File changed
  if (isFileChangedEvent(event)) {
    const data = event.data as any;
    const actor = event.actor.name || event.actor.type;

    // Handle summary events (multiple files)
    if (data.files && Array.isArray(data.files)) {
      const fileCount = data.fileCount || data.files.length;
      const additions = data.additions || 0;
      const deletions = data.deletions || 0;
      const fileList = data.files
        .slice(0, 3)
        .map((f: { path: string; action: string }) => f.path)
        .join(', ');
      const moreCount = fileCount > 3 ? ` (+${fileCount - 3} more)` : '';
      return `[file:changed] ${fileCount} files changed by ${actor}\n   - Files: ${fileList}${moreCount}\n   - Changes: +${additions} / -${deletions}`;
    }

    // Handle single file events
    const { relativePath, path, action, additions, deletions } = data;
    const filePath = relativePath || path || 'unknown file';
    const pastTense = getActionPastTense(action || 'modify');
    let msg = `[file:${action || 'changed'}] ${filePath} was ${pastTense} by ${actor}`;
    if (additions !== undefined || deletions !== undefined) {
      msg += `\n   - Changes: +${additions || 0} / -${deletions || 0}`;
    }
    return msg;
  }

  // Task status changed
  if (isTaskStatusChangedEvent(event)) {
    const { noteTitle, previousStatus, newStatus, agentId } = event.data;
    let msg = `[task:status-changed] "${noteTitle}" changed from ${previousStatus} to ${newStatus}`;
    if (agentId) {
      msg += `\n   - Changed by agent: ${agentId}`;
    }
    return msg;
  }

  // Note changed
  if (isNoteChangedEvent(event)) {
    const { title, action } = event.data;
    const actor = event.actor.name || event.actor.type;
    const pastTense = getActionPastTense(action);
    return `[note:${action}] "${title || 'Untitled'}" was ${pastTense} by ${actor}`;
  }

  // Agent tool call
  if (isAgentToolCallEvent(event)) {
    const { toolName, status, filesModified } = event.data;
    // i18n-ignore (agent-facing notification content)
    const agentName = event.actor.name || 'Unknown agent';
    let msg = `[agent:tool:call] ${agentName} called ${toolName} (${status})`;
    if (filesModified && filesModified.length > 0) {
      msg += `\n   - Files modified: ${filesModified.slice(0, 3).join(', ')}${filesModified.length > 3 ? ` (+${filesModified.length - 3} more)` : ''}`;
    }
    return msg;
  }

  // Generic fallback
  // i18n-ignore (agent-facing notification content)
  return `[${event.type}] Event at ${timestamp} by ${event.actor.name || event.actor.type}`;
}

/**
 * Group events by their type category
 */
function groupEventsByType(events: WorkspaceEvent[]): Record<string, WorkspaceEvent[]> {
  const groups: Record<string, WorkspaceEvent[]> = {};

  // Priority order for event types
  const priorityOrder = [
    'agent:message:received',
    'agent:message:sent',
    'agent:created',
    'agent:deleted',
    'agent:idle',
    'task:status-changed',
    'file:changed',
    'note:',
    'agent:tool:call',
  ];

  for (const event of events) {
    const category = getEventCategory(event.type);
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(event);
  }

  // Sort groups by priority
  const sortedGroups: Record<string, WorkspaceEvent[]> = {};
  for (const priority of priorityOrder) {
    for (const [category, categoryEvents] of Object.entries(groups)) {
      if (category.startsWith(priority) || category === priority) {
        sortedGroups[category] = categoryEvents;
        delete groups[category];
      }
    }
  }

  // Add remaining groups
  for (const [category, categoryEvents] of Object.entries(groups)) {
    sortedGroups[category] = categoryEvents;
  }

  return sortedGroups;
}

/**
 * Get the category for an event type
 */
function getEventCategory(type: string): string {
  // Use the full type as category for now
  return type;
}

/**
 * Create a summary of events for logging
 */
export function summarizeEvents(events: WorkspaceEvent[]): string {
  // i18n-ignore (agent-facing notification content)
  if (events.length === 0) return 'No events';

  const typeCounts: Record<string, number> = {};
  for (const event of events) {
    typeCounts[event.type] = (typeCounts[event.type] || 0) + 1;
  }

  const parts = Object.entries(typeCounts)
    .map(([type, count]) => `${type}: ${count}`)
    .join(', ');

  return `${events.length} events (${parts})`;
}
