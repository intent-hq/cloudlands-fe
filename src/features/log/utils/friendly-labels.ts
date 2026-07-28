/**
 * Friendly Activity Labels
 *
 * Generates natural language labels for activity events in a format
 * suitable for the timeline view with inline entity references.
 */

import type { WorkspaceEvent } from '../../events/types';
import { smartTruncate } from './smart-truncate';
import { m } from '$shared/paraglide/messages.js';

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
  if (!event?.actor) return m.log_friendlyLabels_agentFallback_label();
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

    // Return the generic agent label if name is missing, is the wire placeholder
    // 'Unknown', or is an agent ID
    // i18n-ignore ('Unknown' is a wire placeholder value, not user-facing)
    if (!name || name === 'Unknown' || looksLikeAgentId(name)) {
      // Try to resolve from actorId if we have a resolver
      if (resolver && actorId) {
        const resolvedName = resolver(actorId);
        if (resolvedName && !looksLikeAgentId(resolvedName)) {
          return resolvedName;
        }
      }
      return m.log_friendlyLabels_agentFallback_label();
    }
    return name;
  }
  return m.log_friendlyLabels_youFallback_label();
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
    return { parts: [m.log_friendlyLabels_unknownActivity_label()], verb: 'unknown' };
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
      const verbPhrases = {
        created: {
          byAgent: m.log_friendlyLabels_createdByAgent_middle,
          standalone: m.log_friendlyLabels_created_before,
          file: m.log_friendlyLabels_createdFile_after,
        },
        deleted: {
          byAgent: m.log_friendlyLabels_deletedByAgent_middle,
          standalone: m.log_friendlyLabels_deleted_before,
          file: m.log_friendlyLabels_deletedFile_after,
        },
        updated: {
          byAgent: m.log_friendlyLabels_updatedByAgent_middle,
          standalone: m.log_friendlyLabels_updated_before,
          file: m.log_friendlyLabels_updatedFile_after,
        },
      }[verb];

      if (filePath) {
        const { filename } = parseFilePath(filePath);
        return {
          parts: makeParts(
            isAgent ? agentRef(actorName, event.actor?.id) : null,
            isAgent ? verbPhrases.byAgent() : verbPhrases.standalone(),
            fileRef(filename, filePath),
          ),
          verb,
        };
      }
      return { parts: makeParts(agentRef(actorName, event.actor?.id), verbPhrases.file()), verb };
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
            isAgent ? m.log_friendlyLabels_renamedByAgent_middle() : m.log_friendlyLabels_renamed_before(),
            fileRef(oldName, oldPath),
            ' → ',
            fileRef(newName, newPath),
          ),
          verb: 'renamed',
        };
      }
      return {
        parts: makeParts(agentRef(actorName, event.actor?.id), m.log_friendlyLabels_renamedFile_after()),
        verb: 'renamed',
      };
    }

    // Note events
    case 'note:created':
    case 'note:updated':
    case 'note:deleted': {
      const title = data?.title || m.log_friendlyLabels_untitledNote_label();
      const verb = event.type.split(':')[1];
      const notePhrases = {
        created: { byAgent: m.log_friendlyLabels_createdByAgent_middle, standalone: m.log_friendlyLabels_created_before },
        updated: { byAgent: m.log_friendlyLabels_updatedByAgent_middle, standalone: m.log_friendlyLabels_updated_before },
        deleted: { byAgent: m.log_friendlyLabels_deletedByAgent_middle, standalone: m.log_friendlyLabels_deleted_before },
      }[verb as 'created' | 'updated' | 'deleted'];
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? notePhrases.byAgent() : notePhrases.standalone(),
          noteRef(title),
        ),
        verb,
      };
    }

    // Agent events
    case 'agent:started':
      return {
        parts: [agentRef(actorName, event.actor?.id), m.log_friendlyLabels_startedWorking_after()],
        verb: 'started',
      };

    case 'agent:completed':
      return {
        parts: [agentRef(actorName, event.actor?.id), m.log_friendlyLabels_finishedTask_after()],
        verb: 'completed',
      };

    case 'agent:failed':
      return {
        parts: [agentRef(actorName, event.actor?.id), m.log_friendlyLabels_encounteredError_after()],
        verb: 'failed',
      };

    case 'agent:tool:call': {
      const toolName = data?.toolName || data?.name || m.log_friendlyLabels_toolFallback_label();
      return {
        parts: [agentRef(actorName, event.actor?.id), m.log_friendlyLabels_usedTool_middle(), textRef(toolName)],
        verb: 'used',
      };
    }

    case 'agent:created': {
      const agentId = data?.agentId || event.actor?.id;
      return {
        parts: [m.log_friendlyLabels_startedAgent_before(), agentRef(actorName, agentId)],
        verb: 'started',
      };
    }

    case 'agent:idle': {
      const agentId = data?.agentId || event.actor?.id;
      return {
        parts: [agentRef(actorName, agentId), m.log_friendlyLabels_finished_after()],
        verb: 'finished',
      };
    }

    case 'agent:status-changed': {
      const status = data?.status || data?.newStatus || 'updated';
      const agentId = data?.agentId || event.actor?.id;
      // Skip showing status-changed for idle/responding - they're noisy
      if (status === 'idle') {
        return {
          parts: [agentRef(actorName, agentId), m.log_friendlyLabels_finished_after()],
          verb: 'finished',
        };
      }
      if (status === 'responding' || status === 'streaming' || status === 'thinking') {
        return {
          parts: [agentRef(actorName, agentId), m.log_friendlyLabels_isWorking_after()],
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
        parts: [agentRef(actorName, agentId), m.log_friendlyLabels_sentMessage_after()],
        verb: 'sent',
      };
    }

    case 'agent:message:received': {
      const agentId = data?.toAgentId || event.actor?.id;
      return {
        parts: [agentRef(actorName, agentId), m.log_friendlyLabels_receivedMessage_after()],
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
            isAgent ? m.log_friendlyLabels_markedByAgent_middle() : m.log_friendlyLabels_marked_before(),
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
            ? m.log_friendlyLabels_agentMarkedTask_after({ status: friendlyStatus.toLowerCase() })
            : m.log_friendlyLabels_taskMarked_label({ status: friendlyStatus.toLowerCase() }),
        ),
        verb: 'updated',
      };
    }

    case 'task:ready-tasks-changed':
      return {
        parts: [m.log_friendlyLabels_taskQueueUpdated_label()],
        verb: 'updated',
      };

    // Git events
    case 'git:commit': {
      const message = data?.message;
      const truncated = message && message.length > 50 ? `${message.slice(0, 47)}...` : message;
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? m.log_friendlyLabels_committedByAgent_middle() : m.log_friendlyLabels_committed_before(),
          truncated ? `"${truncated}"` : m.log_friendlyLabels_changesFallback_label(),
        ),
        verb: 'committed',
      };
    }

    case 'git:push':
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? m.log_friendlyLabels_pushedToByAgent_middle() : m.log_friendlyLabels_pushedTo_before(),
          data?.branch ? branchRef(data.branch) : m.log_friendlyLabels_remoteFallback_label(),
        ),
        verb: 'pushed',
      };

    case 'git:pull':
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? m.log_friendlyLabels_pulledFromByAgent_middle() : m.log_friendlyLabels_pulledFrom_before(),
          data?.branch ? branchRef(data.branch) : m.log_friendlyLabels_remoteFallback_label(),
        ),
        verb: 'pulled',
      };

    // Terminal events
    case 'terminal:command': {
      const cmd = data?.command || m.log_friendlyLabels_commandFallback_label();
      const short = cmd.length > 40 ? `${cmd.slice(0, 37)}...` : cmd;
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? m.log_friendlyLabels_ranByAgent_middle() : m.log_friendlyLabels_ran_before(),
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
          isAgent ? m.log_friendlyLabels_startedByAgent_middle() : m.log_friendlyLabels_startedAgent_before(),
          data?.url ? textRef(data.url) : m.log_friendlyLabels_devServerFallback_label(),
        ),
        verb: 'started',
      };

    case 'server:stopped':
    case 'dev-server:stopped':
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? m.log_friendlyLabels_stoppedDevServer_after() : m.log_friendlyLabels_devServerStopped_label(),
        ),
        verb: 'stopped',
      };

    // Browser events
    case 'browser:opened':
    case 'browser:tab-opened':
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? m.log_friendlyLabels_openedBrowser_after() : m.log_friendlyLabels_openedBrowser_label(),
          data?.url ? ` → ${data.url}` : null,
        ),
        verb: 'opened',
      };

    case 'browser:screenshot':
      return {
        parts: makeParts(
          isAgent ? agentRef(actorName, event.actor?.id) : null,
          isAgent ? m.log_friendlyLabels_tookScreenshot_after() : m.log_friendlyLabels_screenshotCaptured_label(),
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
      return m.log_friendlyLabels_statusIdle_after();
    case 'responding':
    case 'streaming':
      return m.log_friendlyLabels_statusResponding_after();
    case 'thinking':
      return m.log_friendlyLabels_statusThinking_after();
    case 'working':
      return m.log_friendlyLabels_isWorking_after();
    case 'waiting':
    case 'waiting_for_input':
    case 'waiting-for-input':
      return m.log_friendlyLabels_statusWaiting_after();
    case 'paused':
      return m.log_friendlyLabels_statusPaused_after();
    case 'stopped':
      return m.log_friendlyLabels_statusStopped_after();
    case 'error':
    case 'failed':
      return m.log_friendlyLabels_encounteredError_after();
    case 'completed':
    case 'done':
      return m.log_friendlyLabels_statusCompleted_after();
    default:
      // For unknown statuses, use a generic format
      return m.log_friendlyLabels_statusGeneric_after({ status: normalized });
  }
}
