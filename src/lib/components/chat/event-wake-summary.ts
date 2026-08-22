/**
 * Shared, dependency-light helpers for summarizing workspace event wakes
 * (`[WORKSPACE EVENTS]` notifications) in the chat UI. Used by
 * EventWakeupBanner (divider banner).
 */

import { m } from '$shared/paraglide/messages.js';
import { looksLikeAgentId } from '$shared/utils/agent-name-utils';

/** First value that is a non-empty (non-whitespace) string, if any. */
export function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

/**
 * Extract agentId + display name from one legacy wake-message event line
 * (the text after the "N. [type] " prefix). Name sources, in order: a quoted
 * "Name", else the daemon's unquoted `Child agent NAME (agent-id)` wording.
 * Names that are themselves agent-id-shaped are dropped so callers never
 * render a raw UUID.
 */
export function parseLegacyEventLine(rawSummary: string): {
  agentId?: string;
  agentName?: string;
} {
  // Extract agentId - try new format first: {{agentId:xxx}}
  let agentId = rawSummary.match(/\{\{agentId:([^}]+)\}\}/)?.[1];
  // Fallback: old format with ID in parentheses: (agent-xxx-xxx-xxx)
  if (!agentId) agentId = rawSummary.match(/\((agent-[a-f0-9-]+)\)/i)?.[1];

  let agentName = rawSummary.match(/"([^"]+)"/)?.[1];
  if (!agentName) {
    agentName = rawSummary.match(/child agent\s+(.+?)\s*\(agent-[a-f0-9-]+\)/i)?.[1];
  }
  if (agentName && looksLikeAgentId(agentName)) agentName = undefined;
  return { agentId, agentName };
}

/** Ordered mapping of non-agent event-type prefixes to human category labels. */
const EVENT_CATEGORY_LABELS: ReadonlyArray<readonly [prefix: string, label: () => string]> = [
  ['file:', () => m.chat_eventWake_category_fileChanges()],
  ['task:', () => m.chat_eventWake_category_taskUpdates()],
  ['note:', () => m.chat_eventWake_category_noteChanges()],
  ['git:', () => m.chat_eventWake_category_gitActivity()],
  ['terminal:', () => m.chat_eventWake_category_terminalActivity()],
  ['test:', () => m.chat_eventWake_category_testActivity()],
  ['build:', () => m.chat_eventWake_category_buildActivity()],
  ['comment:', () => m.chat_eventWake_category_commentUpdates()],
  ['workspace:', () => m.chat_eventWake_category_workspaceUpdates()],
  ['spec:', () => m.chat_eventWake_category_specUpdates()],
  ['goal:', () => m.chat_eventWake_category_goalUpdates()],
];

/** Map non-agent event types to human category labels (e.g. "file changes"). */
export function categorizeEventTypes(types: string[]): string[] {
  return EVENT_CATEGORY_LABELS.filter(([prefix]) => types.some((t) => t.startsWith(prefix))).map(
    ([, label]) => label(),
  );
}
