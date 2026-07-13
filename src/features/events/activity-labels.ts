/**
 * Activity Label Utilities
 *
 * Provides natural language labels for workspace activity events.
 * Each event type has a getLabel function that generates a human-readable description.
 * Supports structured labels with styling for rich text rendering.
 */

import type { WorkspaceEvent } from './types';

/**
 * A part of a label that can be styled differently
 */
export interface LabelPart {
  text: string;
  /** If true, render with semibold weight and foreground color */
  emphasis?: boolean;
}

/**
 * Structured label with styled parts for rich text rendering
 */
export type StructuredLabel = LabelPart[];

/**
 * Truncate a string to a maximum length, adding ellipsis if needed
 */
function truncate(str: string, maxLength: number = 40): string {
  if (!str) return str;
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Get the actor name from an event, with truncation
 */
function getActorName(event: WorkspaceEvent, fallback: string = 'Agent'): string {
  const name = event.actor?.name;
  if (name) return truncate(name, 30);
  return fallback;
}

/**
 * Parse a file path to extract filename and directory
 */
function parseFilePath(path: string): { filename: string; directory: string } {
  const parts = path.split('/');
  const filename = parts.pop() || path;
  const directory = parts.join('/');
  return { filename, directory };
}

/**
 * Label generator for a specific event type
 */
type LabelGenerator = (event: WorkspaceEvent) => string;

/**
 * Structured label generator for a specific event type
 */
type StructuredLabelGenerator = (event: WorkspaceEvent) => StructuredLabel;

/**
 * Map of event types to their label generators
 */
const labelGenerators: Record<string, LabelGenerator> = {
  // File events - include actor name when available
  'file:changed': (event) => {
    const data = event.data as any;
    const filename = data?.path ? truncate(parseFilePath(data.path).filename, 35) : 'file';
    const actor = getActorName(event, '');
    const action = data?.action;

    const verb =
      action === 'create'
        ? 'created'
        : action === 'delete'
          ? 'deleted'
          : action === 'rename'
            ? 'renamed'
            : 'updated';

    if (actor) {
      return `${actor} ${verb} ${filename}`;
    }
    return `${verb.charAt(0).toUpperCase() + verb.slice(1)} ${filename}`;
  },

  'file:created': (event) => {
    const data = event.data as any;
    const filename = data?.path ? truncate(parseFilePath(data.path).filename, 35) : 'file';
    const actor = getActorName(event, '');
    if (actor) {
      return `${actor} created ${filename}`;
    }
    return `Created ${filename}`;
  },

  'file:deleted': (event) => {
    const data = event.data as any;
    const filename = data?.path ? truncate(parseFilePath(data.path).filename, 35) : 'file';
    const actor = getActorName(event, '');
    if (actor) {
      return `${actor} deleted ${filename}`;
    }
    return `Deleted ${filename}`;
  },

  'file:renamed': (event) => {
    const data = event.data as any;
    const filename = data?.path ? truncate(parseFilePath(data.path).filename, 30) : 'file';
    const oldFilename = data?.oldPath ? truncate(parseFilePath(data.oldPath).filename, 20) : null;
    const actor = getActorName(event, '');
    if (oldFilename) {
      if (actor) {
        return `${actor} renamed ${oldFilename} → ${filename}`;
      }
      return `Renamed ${oldFilename} → ${filename}`;
    }
    if (actor) {
      return `${actor} renamed ${filename}`;
    }
    return `Renamed ${filename}`;
  },

  // Note events - include note title with truncation
  'note:created': (event) => {
    const data = event.data as any;
    const title = truncate(data?.title || data?.name || 'note', 35);
    const actor = getActorName(event, '');
    if (actor) {
      return `${actor} created "${title}"`;
    }
    return `Created "${title}"`;
  },

  'note:updated': (event) => {
    const data = event.data as any;
    const title = truncate(data?.title || data?.name || 'note', 35);
    const actor = getActorName(event, '');
    if (actor) {
      return `${actor} updated "${title}"`;
    }
    return `Updated "${title}"`;
  },

  'note:deleted': (event) => {
    const data = event.data as any;
    const title = truncate(data?.title || data?.name || 'note', 35);
    const actor = getActorName(event, '');
    if (actor) {
      return `${actor} deleted "${title}"`;
    }
    return `Deleted "${title}"`;
  },

  // Git events
  'git:commit': (event) => {
    const data = event.data as any;
    const message = data?.message;
    if (message) {
      // Truncate long commit messages
      const truncated = message.length > 40 ? `${message.slice(0, 37)}...` : message;
      return `Committed: ${truncated}`;
    }
    return 'Made a commit';
  },

  'git:push': () => 'Pushed changes',

  'git:pull': () => 'Pulled changes',

  'git:branch': (event) => {
    const data = event.data as any;
    const branch = data?.branch || data?.name;
    if (branch) {
      return `Switched to ${branch}`;
    }
    return 'Changed branch';
  },

  'git:merge': (event) => {
    const data = event.data as any;
    const branch = data?.branch || data?.source;
    if (branch) {
      return `Merged ${branch}`;
    }
    return 'Merged branches';
  },

  // Agent events - always try to show agent name from actor or data
  'agent:started': (event) => {
    const data = event.data as any;
    // Try actor name first, then data fields
    const name = truncate(
      event.actor?.name || data?.name || data?.agentName || data?.taskTitle || '',
      35,
    );
    if (name) {
      return `${name} started working`;
    }
    return 'Agent started';
  },

  'agent:completed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return `${name} completed`;
    }
    return 'Agent completed';
  },

  'agent:failed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return `${name} failed`;
    }
    return 'Agent failed';
  },

  'agent:deleted': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return `Deleted ${name}`;
    }
    return 'Agent deleted';
  },

  'agent:message': (event) => {
    const name = truncate(getActorName(event, ''), 30);
    if (name) {
      return `${name} sent a message`;
    }
    return 'Agent sent message';
  },

  'agent:idle': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return `${name} finished`;
    }
    return 'Agent finished';
  },

  'agent:status-changed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 30);
    const status = data?.status || data?.newStatus;
    const displayName = name || 'Agent';

    // Map status to friendly phrase
    switch (status) {
      case 'idle':
        return `${displayName} finished`;
      case 'responding':
      case 'streaming':
      case 'thinking':
        return `${displayName} is working`;
      case 'waiting':
      case 'waiting_for_input':
        return `${displayName} is waiting`;
      case 'completed':
      case 'done':
        return `${displayName} completed`;
      case 'error':
      case 'failed':
        return `${displayName} encountered an error`;
      default:
        if (status) {
          return `${displayName} is ${status}`;
        }
        return `${displayName} status changed`;
    }
  },

  'agent:tool:call': (event) => {
    const data = event.data as any;
    const toolName = truncate(data?.toolName || data?.name || '', 25);
    const actor = truncate(getActorName(event, ''), 25);
    if (toolName && actor) {
      return `${actor} used ${toolName}`;
    }
    if (toolName) {
      return `Used ${toolName}`;
    }
    return 'Used a tool';
  },

  'agent:created': (event) => {
    const data = event.data as any;
    // Use the agent name from data (the created agent), not actor.name (who created it)
    const agentName = truncate(data?.agentName || data?.name || '', 20);
    const creatorName = truncate(getActorName(event, ''), 20);
    if (agentName && creatorName) {
      return `${creatorName} created ${agentName}`;
    }
    if (agentName) {
      return `Created agent ${agentName}`;
    }
    if (creatorName) {
      return `${creatorName} created an agent`;
    }
    return 'Created new agent';
  },

  // Task events - show task name and status clearly
  'task:status-changed': (event) => {
    const data = event.data as any;
    const taskName = truncate(data?.taskName || data?.noteTitle || '', 30);
    const newStatus = data?.newStatus || data?.status;
    const actor = truncate(getActorName(event, ''), 25);

    // Convert status to friendly format
    let friendlyStatus = 'updated';
    if (newStatus) {
      const statusLower = newStatus.toLowerCase().replace(/_/g, ' ');
      if (statusLower === 'complete' || statusLower === 'completed' || statusLower === 'done') {
        friendlyStatus = 'complete';
      } else if (statusLower === 'in progress' || statusLower === 'in_progress') {
        friendlyStatus = 'in progress';
      } else if (statusLower === 'cancelled' || statusLower === 'canceled') {
        friendlyStatus = 'cancelled';
      } else {
        friendlyStatus = statusLower;
      }
    }

    if (taskName && taskName !== 'task') {
      if (actor) {
        return `${actor} marked "${taskName}" ${friendlyStatus}`;
      }
      return `"${taskName}" marked ${friendlyStatus}`;
    }
    if (actor) {
      return `${actor} updated task status`;
    }
    return `Task marked ${friendlyStatus}`;
  },

  'task:ready-tasks-changed': (event) => {
    const data = event.data as any;
    const count = data?.count || data?.taskCount;
    if (typeof count === 'number') {
      return count === 1 ? '1 task ready' : `${count} tasks ready`;
    }
    return 'Ready tasks updated';
  },

  // Terminal events
  'terminal:command': (event) => {
    const data = event.data as any;
    const command = data?.command;
    const actor = truncate(getActorName(event, ''), 25);
    if (command) {
      const truncatedCmd = truncate(command, 25);
      if (actor) {
        return `${actor} ran ${truncatedCmd}`;
      }
      return `Ran ${truncatedCmd}`;
    }
    if (actor) {
      return `${actor} ran a command`;
    }
    return 'Ran command';
  },

  // Test events
  'test:started': (event) => {
    const data = event.data as any;
    const testName = truncate(data?.testName || data?.testSuite || '', 30);
    const actor = truncate(getActorName(event, ''), 25);
    if (testName) {
      if (actor) {
        return `${actor} started testing ${testName}`;
      }
      return `Started testing ${testName}`;
    }
    if (actor) {
      return `${actor} started tests`;
    }
    return 'Started tests';
  },

  'test:completed': (event) => {
    const data = event.data as any;
    const status = data?.status;
    const testName = truncate(data?.testName || data?.testSuite || '', 30);

    if (status === 'passed') {
      return testName ? `Tests passed: ${testName}` : 'Tests passed';
    } else if (status === 'failed') {
      return testName ? `Tests failed: ${testName}` : 'Tests failed';
    }
    return testName ? `Tests completed: ${testName}` : 'Tests completed';
  },

  // Build events
  'build:started': (event) => {
    const data = event.data as any;
    const target = truncate(data?.target || '', 30);
    const actor = truncate(getActorName(event, ''), 25);
    if (target) {
      if (actor) {
        return `${actor} started building ${target}`;
      }
      return `Started building ${target}`;
    }
    if (actor) {
      return `${actor} started build`;
    }
    return 'Started build';
  },

  'build:completed': (event) => {
    const data = event.data as any;
    const status = data?.status;
    const target = truncate(data?.target || '', 30);

    if (status === 'success') {
      return target ? `Build succeeded: ${target}` : 'Build succeeded';
    } else if (status === 'failed') {
      return target ? `Build failed: ${target}` : 'Build failed';
    }
    return target ? `Build completed: ${target}` : 'Build completed';
  },

  // Workspace events
  'workspace:created': (event) => {
    const data = event.data as any;
    const name = truncate(data?.name || '', 35);
    if (name) {
      return `Created workspace "${name}"`;
    }
    return 'Created workspace';
  },
  'workspace:updated': (event) => {
    const data = event.data as any;
    const name = truncate(data?.name || '', 35);
    if (name) {
      return `Updated workspace "${name}"`;
    }
    return 'Updated workspace';
  },
  'workspace:deleted': (event) => {
    const data = event.data as any;
    const name = truncate(data?.name || '', 35);
    if (name) {
      return `Deleted workspace "${name}"`;
    }
    return 'Deleted workspace';
  },
  'workspace:opened': (event) => {
    const data = event.data as any;
    const name = truncate(data?.name || '', 35);
    if (name) {
      return `Opened "${name}"`;
    }
    return 'Opened workspace';
  },
  'workspace:closed': (event) => {
    const data = event.data as any;
    const name = truncate(data?.name || '', 35);
    if (name) {
      return `Closed "${name}"`;
    }
    return 'Closed workspace';
  },
  'workspace:activity': (event) => {
    const data = event.data as any;
    const description = truncate(data?.description || '', 40);
    if (description) {
      return description;
    }
    return 'Workspace activity';
  },

  // Spec events
  'spec:updated': (event) => {
    const data = event.data as any;
    const section = truncate(data?.section || '', 30);
    const actor = truncate(getActorName(event, ''), 25);
    if (section) {
      if (actor) {
        return `${actor} updated spec: ${section}`;
      }
      return `Updated spec: ${section}`;
    }
    if (actor) {
      return `${actor} updated spec`;
    }
    return 'Updated spec';
  },

  'goal:updated': (event) => {
    const actor = truncate(getActorName(event, ''), 30);
    if (actor) {
      return `${actor} updated goal`;
    }
    return 'Updated goal';
  },

  // Comment events
  'comment:added': (event) => {
    const data = event.data as any;
    const author = truncate(event.actor?.name || data?.author || data?.authorName || '', 30);
    const preview = truncate(data?.preview || data?.text || '', 25);
    if (author && preview) {
      return `${author} commented: "${preview}"`;
    }
    if (author) {
      return `${author} commented`;
    }
    if (preview) {
      return `Comment: "${preview}"`;
    }
    return 'Comment added';
  },

  // Agent message events (for agent-to-agent communication)
  'agent:message:sent': (event) => {
    const data = event.data as any;
    const fromName = truncate(event.actor?.name || data?.fromAgentName || 'Agent', 25);
    const toName = truncate(data?.toAgentName || '', 25);
    if (toName) {
      return `${fromName} messaged ${toName}`;
    }
    return `${fromName} sent a message`;
  },

  'agent:message:received': (event) => {
    const data = event.data as any;
    const fromName = truncate(data?.fromAgentName || '', 25);
    const toName = truncate(event.actor?.name || data?.toAgentName || 'Agent', 25);
    if (fromName) {
      return `${toName} received message from ${fromName}`;
    }
    return `${toName} received a message`;
  },

  // Agent subscription events
  'agent:subscribed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.agentName || 'Agent', 30);
    const eventTypes = data?.eventTypes;
    if (eventTypes?.length === 1) {
      return `${name} is watching ${eventTypes[0].split(':')[0]} events`;
    }
    if (eventTypes?.length > 1) {
      return `${name} is watching for updates`;
    }
    return `${name} started watching`;
  },

  'agent:unsubscribed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.agentName || 'Agent', 30);
    return `${name} stopped watching`;
  },

  'agent:woken-by-subscription': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.agentName || 'Agent', 30);
    const eventCount = data?.eventCount || 1;
    if (eventCount === 1) {
      return `${name} resumed`;
    }
    return `${name} resumed (${eventCount} events)`;
  },

  // Agent resumed event (different from woken-by-subscription)
  'agent:resumed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.agentName || data?.name || '', 35);
    if (name) {
      return `${name} resumed`;
    }
    return 'Agent resumed';
  },
};

/**
 * Get a natural language label for an activity event
 */
export function getActivityLabel(event: WorkspaceEvent): string {
  // Guard against undefined event or type
  if (!event?.type) {
    return 'Unknown activity';
  }

  const generator = labelGenerators[event.type];
  if (generator) {
    try {
      return generator(event);
    } catch {
      // Fall through to default
    }
  }

  // Default: convert event type to readable format
  // e.g., 'file:changed' -> 'File changed'
  const parts = event.type.split(':');
  if (parts.length >= 2) {
    const [category, action] = parts;
    return `${category.charAt(0).toUpperCase() + category.slice(1)} ${action}`;
  }

  return event.type.replace(/[_:]/g, ' ');
}

/**
 * Get a short label (just the action verb) for compact displays
 */
export function getActivityVerb(event: WorkspaceEvent): string {
  const data = event.data as any;

  switch (event.type) {
    case 'file:changed':
      switch (data?.action) {
        case 'create':
          return 'Created';
        case 'delete':
          return 'Deleted';
        case 'rename':
          return 'Renamed';
        default:
          return 'Updated';
      }
    case 'file:created':
      return 'Created';
    case 'file:deleted':
      return 'Deleted';
    case 'file:renamed':
      return 'Renamed';
    case 'note:created':
      return 'Created';
    case 'note:updated':
      return 'Updated';
    case 'note:deleted':
      return 'Deleted';
    case 'git:commit':
      return 'Committed';
    case 'git:push':
      return 'Pushed';
    case 'git:pull':
      return 'Pulled';
    case 'agent:started':
      return 'Started';
    case 'agent:completed':
      return 'Completed';
    case 'terminal:command':
      return 'Ran';
    default:
      return event.type.split(':')[1] || 'Activity';
  }
}

/**
 * Get the subject of the activity (e.g., filename, note title)
 */
export function getActivitySubject(event: WorkspaceEvent): string | null {
  const data = event.data as any;

  if (event.type.startsWith('file:') && data?.path) {
    return parseFilePath(data.path).filename;
  }

  if (event.type.startsWith('note:') && data?.title) {
    return data.title;
  }

  if (event.type === 'agent:tool:call' && data?.toolName) {
    return data.toolName;
  }

  if (event.type === 'terminal:command' && data?.command) {
    const truncated = data.command.length > 30 ? `${data.command.slice(0, 27)}...` : data.command;
    return truncated;
  }

  return null;
}

/**
 * Map of event types to their structured label generators
 * These return arrays of LabelParts with optional emphasis for semibold styling
 */
const structuredLabelGenerators: Record<string, StructuredLabelGenerator> = {
  // File events - actor and filename get emphasis
  'file:changed': (event) => {
    const data = event.data as any;
    const filename = data?.path ? truncate(parseFilePath(data.path).filename, 35) : 'file';
    const actor = getActorName(event, '');
    const action = data?.action;
    const verb =
      action === 'create'
        ? 'created'
        : action === 'delete'
          ? 'deleted'
          : action === 'rename'
            ? 'renamed'
            : 'updated';
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: ` ${verb} ` },
        { text: filename, emphasis: true },
      ];
    }
    return [{ text: `${verb.charAt(0).toUpperCase() + verb.slice(1)} ` }, { text: filename, emphasis: true }];
  },

  'file:created': (event) => {
    const data = event.data as any;
    const filename = data?.path ? truncate(parseFilePath(data.path).filename, 35) : 'file';
    const actor = getActorName(event, '');
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: ' created ' },
        { text: filename, emphasis: true },
      ];
    }
    return [{ text: 'Created ' }, { text: filename, emphasis: true }];
  },

  'file:deleted': (event) => {
    const data = event.data as any;
    const filename = data?.path ? truncate(parseFilePath(data.path).filename, 35) : 'file';
    const actor = getActorName(event, '');
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: ' deleted ' },
        { text: filename, emphasis: true },
      ];
    }
    return [{ text: 'Deleted ' }, { text: filename, emphasis: true }];
  },

  'file:renamed': (event) => {
    const data = event.data as any;
    const filename = data?.path ? truncate(parseFilePath(data.path).filename, 30) : 'file';
    const oldFilename = data?.oldPath ? truncate(parseFilePath(data.oldPath).filename, 20) : null;
    const actor = getActorName(event, '');
    if (oldFilename) {
      if (actor) {
        return [
          { text: actor, emphasis: true },
          { text: ' renamed ' },
          { text: oldFilename, emphasis: true },
          { text: ' → ' },
          { text: filename, emphasis: true },
        ];
      }
      return [
        { text: 'Renamed ' },
        { text: oldFilename, emphasis: true },
        { text: ' → ' },
        { text: filename, emphasis: true },
      ];
    }
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: ' renamed ' },
        { text: filename, emphasis: true },
      ];
    }
    return [{ text: 'Renamed ' }, { text: filename, emphasis: true }];
  },

  // Note events - actor and note title get emphasis (no quotes)
  'note:created': (event) => {
    const data = event.data as any;
    const title = truncate(data?.title || data?.name || 'note', 35);
    const actor = getActorName(event, '');
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: ' created ' },
        { text: title, emphasis: true },
      ];
    }
    return [{ text: 'Created ' }, { text: title, emphasis: true }];
  },

  'note:updated': (event) => {
    const data = event.data as any;
    const title = truncate(data?.title || data?.name || 'note', 35);
    const actor = getActorName(event, '');
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: ' updated ' },
        { text: title, emphasis: true },
      ];
    }
    return [{ text: 'Updated ' }, { text: title, emphasis: true }];
  },

  'note:deleted': (event) => {
    const data = event.data as any;
    const title = truncate(data?.title || data?.name || 'note', 35);
    const actor = getActorName(event, '');
    if (actor) {
      return [
        { text: actor, emphasis: true },
        { text: ' deleted ' },
        { text: title, emphasis: true },
      ];
    }
    return [{ text: 'Deleted ' }, { text: title, emphasis: true }];
  },

  // Agent events - agent name gets emphasis
  'agent:started': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || data?.taskTitle || '', 35);
    if (name) {
      return [{ text: name, emphasis: true }, { text: ' started working' }];
    }
    return [{ text: 'Agent started' }];
  },

  'agent:completed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return [{ text: name, emphasis: true }, { text: ' completed' }];
    }
    return [{ text: 'Agent completed' }];
  },

  'agent:failed': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return [{ text: name, emphasis: true }, { text: ' failed' }];
    }
    return [{ text: 'Agent failed' }];
  },

  'agent:deleted': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return [{ text: 'Deleted ' }, { text: name, emphasis: true }];
    }
    return [{ text: 'Agent deleted' }];
  },

  'agent:idle': (event) => {
    const data = event.data as any;
    const name = truncate(event.actor?.name || data?.name || data?.agentName || '', 35);
    if (name) {
      return [{ text: name, emphasis: true }, { text: ' finished' }];
    }
    return [{ text: 'Agent finished' }];
  },

  'agent:created': (event) => {
    const data = event.data as any;
    const name = truncate(data?.agentName || data?.name || event.actor?.name || '', 35);
    if (name) {
      return [{ text: name, emphasis: true }, { text: ' created' }];
    }
    return [{ text: 'Agent created' }];
  },
};

/**
 * Get a structured label for an activity event (for rich text rendering)
 * Returns an array of LabelParts with optional emphasis styling
 */
export function getActivityLabelParts(event: WorkspaceEvent): StructuredLabel {
  const generator = structuredLabelGenerators[event.type];
  if (generator) {
    return generator(event);
  }

  // Fall back to plain string label as single part
  const plainLabel = getActivityLabel(event);
  return [{ text: plainLabel }];
}
