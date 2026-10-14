import type { HomeFilter } from '../../../../../src/features/home/home-model';

/** Router context only: readers must independently admit the workspace/session. */
export interface ConversationFileOrigin {
  workspaceId: string;
  agentId: string;
  messageId: string;
}

export function parseConversationFileOrigin(value: unknown): ConversationFileOrigin | undefined {
  if (typeof value === 'string') {
    if (value.length > 1024) return;
    try {
      value = JSON.parse(value);
    } catch {
      return;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const origin = value as Record<string, unknown>;
  const isId = (id: unknown): id is string =>
    typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(id);
  if (!isId(origin.workspaceId) || !isId(origin.agentId) || !isId(origin.messageId)) return;
  return { workspaceId: origin.workspaceId, agentId: origin.agentId, messageId: origin.messageId };
}

type SearchContext = {
  q?: string;
  fileQuery?: string;
  homeQuery?: string;
  homeFilter?: HomeFilter;
};

export function conversationFileSearch(
  context: SearchContext,
  workspaceId: string,
  target: { file: string; line?: number; attachment?: string; attachmentAgent?: string },
  origin: ConversationFileOrigin,
) {
  const parsed =
    origin.workspaceId === workspaceId ? parseConversationFileOrigin(origin) : undefined;
  return {
    q: context.q,
    fileQuery: context.fileQuery,
    homeQuery: context.homeQuery,
    homeFilter: context.homeFilter,
    ...target,
    // The router deliberately uses URLSearchParams, not TanStack's JSON codec.
    fileOrigin: parsed ? JSON.stringify(parsed) : undefined,
  };
}

export function workspaceFileBackSearch(
  workspaceId: string,
  origin: unknown,
  fallback: { note?: string; q?: string; fileQuery?: string },
) {
  const parsed = parseConversationFileOrigin(origin);
  if (parsed?.workspaceId === workspaceId)
    return {
      q: fallback.q,
      fileQuery: fallback.fileQuery,
      agent: parsed.agentId,
      message: parsed.messageId,
    };
  return fallback;
}
