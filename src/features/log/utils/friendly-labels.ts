/**
 * Friendly Activity Labels
 *
 * Generates natural language labels for activity events in a format
 * suitable for the timeline view with inline entity references.
 */

import type { WorkspaceEvent } from '../../events/types';
import { smartTruncate } from './smart-truncate';

export interface EntityRef {
  type: 'file' | 'note' | 'agent' | 'branch' | 'command' | 'text' | 'blank';
  value: string;
  displayValue: string;
  fullPath?: string;
}

export interface FriendlyLabel {
  parts: (string | EntityRef)[];
  verb: string;
}

function parseFilePath(path: string): { filename: string; directory: string } {
  const parts = path.split('/');
  const filename = parts.pop() || path;
  const directory = parts.join('/');
  return { filename, directory };
}

/**
 * Type for agent name resolver function
 * Takes an agent ID and returns the agent name, or undefined if not found
 */
export type AgentNameResolver = (agentId: string) => string | undefined;

/**
 * Check if a name looks like an agent ID (UUID-like format)
 */
function looksLikeAgentId(name: string): boolean {
  // Agent IDs typically start with 'agent-' followed by a UUID pattern
  return /^agent-[a-f0-9-]{36}$/i.test(name);
}

function getActorName(event: WorkspaceEvent, resolver?: AgentNameResolver): string {
  if (!event?.actor) return 'Agent';
  if (event.actor.type === 'agent' || event.actor.type === 'external') {
    const name = event.actor.name;
    const actorId = event.actor.id;

    // If name looks like an agent ID and we have a resolver, try to look up the real name
    if (name && looksLikeAgentId(name) && resolver && actorId) {
      const resolvedName = resolver(actorId);
      if (resolvedName && !looksLikeAgentId(resolvedName)) {
        return resolvedName;
      }
    }

    // Return 'Agent' if name is missing, is the placeholder 'Unknown', or is an agent ID
    if (!name || name === 'Unknown' || looksLikeAgentId(name)) {
      // Try to resolve from actorId if we have a resolver
      if (resolver && actorId) {
        const resolvedName = resolver(actorId);
        if (resolvedName && !looksLikeAgentId(resolvedName)) {
          return resolvedName;
        }
      }
      return 'Agent';
    }
    return name;
  }
  return 'You';
}

// Helper to create entity refs with proper typing
function fileRef(filename: string, fullPath: string): EntityRef {
  return { type: 'file', value: filename, displayValue: filename, fullPath };
}

function noteRef(title: string, noteId?: string): EntityRef {
  return { type: 'note', value: title, displayValue: smartTruncate(title), fullPath: noteId };
}

function agentRef(name: string, agentId?: string): EntityRef {
  return { type: 'agent', value: name, displayValue: smartTruncate(name), fullPath: agentId };
}

function branchRef(branch: string): EntityRef {
  return { type: 'branch', value: branch, displayValue: branch };
}

function commandRef(cmd: string): EntityRef {
  return { type: 'command', value: cmd, displayValue: cmd };
}

function textRef(text: string): EntityRef {
  return { type: 'text', value: text, displayValue: text };
}

function blankRef(text: string): EntityRef {
  return { type: 'blank', value: text, displayValue: text };
}

// Filter and return parts with proper typing
function makeParts(
  ...items: (string | EntityRef | false | null | undefined)[]
): (string | EntityRef)[] {
  return items.filter((item): item is string | EntityRef => Boolean(item));
}

/**
 * Generate a friendly label with structured entity references
 *
 * @param event - The workspace event to generate a label for
 * @param agentNameResolver - Optional function to resolve agent names from agent IDs
 */
export function getFriendlyLabel(
  event: WorkspaceEvent,
  agentNameResolver?: AgentNameResolver,
): FriendlyLabel {
  // Guard against undefined event or type
  if (!event?.type) {
    return { parts: ['Unknown activity'], verb: 'unknown' };
  }

  const data = event.data as any;
  const actorName = getActorName(event, agentNameResolver);
  const isAgent = event.actor?.type === 'agent' || event.actor?.type === 'external';

  // Get base type
  const eventType = event.type as string;

  switch (eventType) {
    // File events
    case 'file:changed':
    case 'file:created':
    case 'file:deleted': {
      const filePath = data?.path || data?.relativePath;
      const action = data?.action || event.type.split(':')[1];
      const verb = action === 'create' ? 'created' : action === 'delete' ? 'deleted' : 'updated';

      if (filePath) {
        const { filename } = parseFilePath(filePath);
        return {
          parts: makeParts(
            isAgent ? agentRef(actorName, event.actor?.id) : null,
            isAgent ? ` ${verb} ` : `${verb.charAt(0).toUpperCase()}${verb.slice(1)} `,
            fileRef(filename, filePath),
          ),
          verb,
        };
      }
      return { parts: makeParts(agentRef(actorName, event.actor?.id), ` ${verb} a file`), verb };
    }

    case 'file:renamed': {
      const newPath = data?.path || data?.relativePath;
      const oldPath = data?.oldPath;
      if (newPath && oldPath) {
        const { filename: newName } = parseFilePath(newPath);
        const { filename: oldName } = parseFilePath(oldPath);
        return {
          parts: makeParts(
            isAgent ? agentRef(actorName, event.actor?.id) : null,
            isAgent ? ' renamed ' : 'Renamed ',
            fileRef(oldName, oldPath),
            ' → ',
            fileRef(newName, newPath),
          ),
          verb: 'renamed',
        };
      }
      return {
        parts: makeParts(agentRef(actorName, event.actor?.id), ' renamed a file'),
        verb: 'renamed',
      };
    }

    // Note events
    case 'note:created':
    case 'note:updated':
    case 'note:deleted': {
      const title = data?.title || 'Untitled';
      const verb = event.type.split(':')[1];
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? ` ${verb} ` : `${verb.charAt(0).toUpperCase()}${verb.slice(1)} `,
          noteRef(title),
        ),
        verb,
      };
    }

    // Agent events
    case 'agent:started':
      return {
        parts: [agentRef(actorName, event.actor?.id), ' started working'],
        verb: 'started',
      };

    case 'agent:completed':
      return {
        parts: [agentRef(actorName, event.actor?.id), ' finished the task'],
        verb: 'completed',
      };

    case 'agent:failed':
      return {
        parts: [agentRef(actorName, event.actor?.id), ' encountered an error'],
        verb: 'failed',
      };

    case 'agent:tool:call': {
      const toolName = data?.toolName || data?.name || 'a tool';
      return {
        parts: [agentRef(actorName, event.actor?.id), ' used ', textRef(toolName)],
        verb: 'used',
      };
    }

    case 'agent:created': {
      const agentId = data?.agentId || event.actor?.id;
      return {
        parts: ['Started ', agentRef(actorName, agentId)],
        verb: 'started',
      };
    }

    case 'agent:idle': {
      const agentId = data?.agentId || event.actor?.id;
      return {
        parts: [agentRef(actorName, agentId), ' finished'],
        verb: 'finished',
      };
    }

    case 'agent:status-changed': {
      const status = data?.status || data?.newStatus || 'updated';
      const agentId = data?.agentId || event.actor?.id;
      // Skip showing status-changed for idle/responding - they're noisy
      if (status === 'idle') {
        return {
          parts: [agentRef(actorName, agentId), ' finished'],
          verb: 'finished',
        };
      }
      if (status === 'responding' || status === 'streaming' || status === 'thinking') {
        return {
          parts: [agentRef(actorName, agentId), ' is working'],
          verb: 'working',
        };
      }
      // Map status to friendly verb phrase
      const statusPhrase = getStatusPhrase(status);
      return {
        parts: [agentRef(actorName, agentId), statusPhrase],
        verb: 'status',
      };
    }

    case 'agent:message':
    case 'agent:message:sent': {
      const agentId = data?.fromAgentId || event.actor?.id;
      return {
        parts: [agentRef(actorName, agentId), ' sent a message'],
        verb: 'sent',
      };
    }

    case 'agent:message:received': {
      const agentId = data?.toAgentId || event.actor?.id;
      return {
        parts: [agentRef(actorName, agentId), ' received a message'],
        verb: 'received',
      };
    }

    // Task events
    case 'task:status-changed': {
      const taskName = data?.taskName || data?.noteTitle;
      const noteId = data?.noteId;
      const newStatus = data?.newStatus || data?.status || 'updated';
      const friendlyStatus = toTitleCase(newStatus);

      // If we have a task name, show "[Agent] marked 'name' status"
      if (taskName && taskName !== 'task') {
        return {
          parts: makeParts(
            isAgent ? agentRef(actorName, event.actor?.id) : null,
            isAgent ? ' marked ' : 'Marked ',
            noteRef(taskName, noteId),
            ` ${friendlyStatus.toLowerCase()}`,
          ),
          verb: 'updated',
        };
      }
      // Otherwise just show "Task marked as Status"
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent
            ? ` marked task ${friendlyStatus.toLowerCase()}`
            : `Task marked ${friendlyStatus.toLowerCase()}`,
        ),
        verb: 'updated',
      };
    }

    case 'task:ready-tasks-changed':
      return {
        parts: ['Task queue updated'],
        verb: 'updated',
      };

    // Git events
    case 'git:commit': {
      const message = data?.message;
      const truncated = message && message.length > 50 ? `${message.slice(0, 47)}...` : message;
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? ' committed ' : 'Committed ',
          truncated ? `"${truncated}"` : 'changes',
        ),
        verb: 'committed',
      };
    }

    case 'git:push':
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? ' pushed to ' : 'Pushed to ',
          data?.branch ? branchRef(data.branch) : 'remote',
        ),
        verb: 'pushed',
      };

    case 'git:pull':
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? ' pulled from ' : 'Pulled from ',
          data?.branch ? branchRef(data.branch) : 'remote',
        ),
        verb: 'pulled',
      };

    // Terminal events
    case 'terminal:command': {
      const cmd = data?.command || 'command';
      const short = cmd.length > 40 ? `${cmd.slice(0, 37)}...` : cmd;
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? ' ran ' : 'Ran ',
          commandRef(short),
        ),
        verb: 'ran',
      };
    }

    // Dev server events
    case 'server:started':
    case 'dev-server:started':
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? ' started ' : 'Started ',
          data?.url ? textRef(data.url) : 'dev server',
        ),
        verb: 'started',
      };

    case 'server:stopped':
    case 'dev-server:stopped':
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? ' stopped dev server' : 'Dev server stopped',
        ),
        verb: 'stopped',
      };

    // Browser events
    case 'browser:opened':
    case 'browser:tab-opened':
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? ' opened browser' : 'Opened browser',
          data?.url ? ` → ${data.url}` : null,
        ),
        verb: 'opened',
      };

    case 'browser:screenshot':
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? ' took a screenshot' : 'Screenshot captured',
        ),
        verb: 'captured',
      };

    default: {
      // Parse event type like "agent:status-changed" into readable format
      const [category, action] = event.type.split(':');
      if (action) {
        // Convert "status-changed" to "status changed"
        const readableAction = action.replace(/-/g, ' ');
        return {
          parts: [`${toTitleCase(category)} ${readableAction}`],
          verb: action,
        };
      }
      return {
        parts: [event.type],
        verb: 'acted',
      };
    }
  }
}

function toTitleCase(str: string) {
  return str
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase())
    .replace(/_/g, ' ');
}

/**
 * Convert agent status to a friendly phrase
 */
function getStatusPhrase(status: string): string {
  const normalized = status.toLowerCase();
  switch (normalized) {
    case 'idle':
      return ' is now idle';
    case 'responding':
    case 'streaming':
      return ' is responding';
    case 'thinking':
      return ' is thinking';
    case 'working':
      return ' is working';
    case 'waiting':
    case 'waiting_for_input':
    case 'waiting-for-input':
      return ' is waiting for input';
    case 'paused':
      return ' was paused';
    case 'stopped':
      return ' was stopped';
    case 'error':
    case 'failed':
      return ' encountered an error';
    case 'completed':
    case 'done':
      return ' completed';
    default:
      // For unknown statuses, use a generic format
      return ` is now ${normalized}`;
  }
}
