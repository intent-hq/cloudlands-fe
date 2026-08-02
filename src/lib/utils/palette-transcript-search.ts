/**
 * Debounced chat-transcript search for the command palette
 * (`search.messages`, PROTOCOL §5.15).
 *
 * Search is global; `preferWorkspaceId` is a soft ranking boost only.
 * Matches are mapped to palette items (one row per matching message).
 */
import { faRobot, faUser } from '@fortawesome/free-solid-svg-icons';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  buildMessageTitleSegments,
  formatRelativeTime,
} from '$store/renderer/slices/command-palette/command-palette-utils';

const logger = createLogger('palette-transcript-search');

const TRANSCRIPT_QUERY_DEBOUNCE_MS = 150;
const TRANSCRIPT_RESULT_LIMIT = 10;

async function fetchTranscriptMatches(
  term: string,
  preferWorkspaceId: string | undefined,
  workspaceItems: any[],
): Promise<any[]> {
  try {
    const params: Record<string, unknown> = { query: term, limit: TRANSCRIPT_RESULT_LIMIT };
    if (preferWorkspaceId) {
      params.preferWorkspaceId = preferWorkspaceId;
    }
    const resp = await backendRequest<{ matches?: any[] }>('search.messages', params);
    const matches = Array.isArray(resp?.matches) ? resp.matches : [];
    const wsById = new Map((workspaceItems || []).map((w: any) => [w.id, w]));
    return matches.slice(0, TRANSCRIPT_RESULT_LIMIT).map((match: any) => ({
      id: `${match.agentId}:${match.messageId}`,
      type: 'message' as const,
      label: match.agentName || m.lib_commandPalette_untitledAgent_fallback(),
      description: match.preview,
      icon: match.role === 'user' ? faUser : faRobot,
      agentId: match.agentId,
      messageId: match.messageId,
      workspaceId: match.workspaceId,
      ...buildMessageTitleSegments(wsById.get(match.workspaceId)),
      role: match.role,
      timestamp: new Date(match.timestamp).getTime(),
      _time: formatRelativeTime(match.timestamp),
    }));
  } catch (error) {
    logger.error('Failed to search chat messages:', error);
    return [];
  }
}

export interface TranscriptQueryUpdate {
  items?: any[];
  loading: boolean;
}

export interface TranscriptQueryController {
  /** Debounce then run a transcript search; stale responses are dropped. */
  query(term: string, preferWorkspaceId: string | undefined, workspaceItems: any[]): void;
  /** Drop pending work and reset to empty results. */
  clear(): void;
  /** Drop pending work without emitting an update (effect cleanup). */
  cancel(): void;
}

/**
 * Create a debounced transcript-query controller. `onUpdate` receives loading
 * transitions and result batches; `items` is omitted while a query is pending
 * so callers keep showing the previous batch.
 */
export function createTranscriptQuery(
  onUpdate: (update: TranscriptQueryUpdate) => void,
): TranscriptQueryController {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let requestId = 0;

  const cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return {
    query(term, preferWorkspaceId, workspaceItems) {
      cancel();
      const id = ++requestId;
      onUpdate({ loading: true });
      timeout = setTimeout(async () => {
        const items = await fetchTranscriptMatches(term, preferWorkspaceId, workspaceItems);
        if (id === requestId) {
          onUpdate({ items, loading: false });
        }
      }, TRANSCRIPT_QUERY_DEBOUNCE_MS);
    },
    clear() {
      cancel();
      ++requestId;
      onUpdate({ items: [], loading: false });
    },
    cancel,
  };
}
