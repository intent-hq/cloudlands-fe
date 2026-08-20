/**
 * Agent Peek Utils
 *
 * Centralized utilities for extracting agent preview/peek data.
 * Used by AgentPeekCard and other components that need to display agent summaries.
 */

import type { AgentSession, AgentMessage, FileOperation, ToolUseBlock } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';

export interface AgentPeekData {
  id: string;
  name: string;
  status: AgentSession['status'];
  lastUserMessage: string;
  lastResponse: string;
  /**
   * Most recent tool call to preview, from the wire `lastToolUse`
   * (AgentLite, PROTOCOL §5.5 / the tool-call arm of `agent:stream:activity`).
   * While streaming it is the live overlay and `lastResponse` is cleared;
   * idle it is only set when there is no response text (response text keeps
   * precedence). Consumers render the tool icon/label preview.
   */
  lastToolUse?: ToolUseBlock;
  fileChanges: FileOperation[];
  messages: AgentMessage[];
  /** Completion report set via report_to_parent tool */
  completionReport?: string;
  /** Wire `digest` (AgentLite, PROTOCOL §5.5), served verbatim */
  digest?: string;
  /** ID of the parent agent that created this agent */
  parentAgentId?: string;
  /**
   * Role of the session's newest user/assistant message: the wire
   * `lastMessageRole` (AgentLite, PROTOCOL §5.5), served verbatim.
   * Undefined when the daemon omits it so consumers keep their existing
   * behavior.
   */
  lastMessageRole?: 'user' | 'assistant';
}

/**
 * Extract peek data from an agent session.
 *
 * Preview fields (`lastResponse`, `lastUserMessage`, `digest`, `lastToolUse`,
 * `lastMessageRole`) are served verbatim from the wire AgentLite fields
 * (PROTOCOL §5.5) — the daemon already cleans them (`clean_response_text`
 * strips `<agent_digest>`, suggested-prompts blocks, group tags). The loaded
 * transcript is never consulted to re-derive previews; absent wire fields
 * yield an empty preview.
 */
export function getAgentPeekData(agent: AgentSession | null | undefined): AgentPeekData | null {
  if (!agent) return null;

  const lastUserMessage = agent.lastUserMessage || '';
  let lastResponse = agent.lastAgentResponse || '';
  let lastToolUse: ToolUseBlock | undefined;
  const digest = agent.digest || undefined;
  const lastMessageRole: 'user' | 'assistant' | undefined =
    agent.lastMessageRole === 'user' || agent.lastMessageRole === 'assistant'
      ? agent.lastMessageRole
      : undefined;

  if (agent.isStreaming && agent.lastToolUse?.name) {
    // The daemon's in-flight activity overlay is fresher than the persisted
    // preview. It is cleared at turn boundaries, so only use it while the
    // session is actively streaming; an idle leftover must not displace the
    // persisted final response.
    lastToolUse = {
      type: 'tool_use',
      id: `live-tool:${agent.id}`,
      name: agent.lastToolUse.name,
      input: {},
    };
    lastResponse = '';
  } else if (!lastResponse && !agent.isStreaming && agent.lastToolUse?.name) {
    // Persisted tool-call preview (AgentLite `lastToolUse`, §5.5 — also
    // applied by `agent:last-message`): an agent whose newest message ended
    // on a tool call has no response text to preview, so the wire preview
    // drives the tool chip. Response text keeps precedence (mirrors the
    // card's last-response > last-tool order).
    lastToolUse = {
      type: 'tool_use',
      id: `wire-tool:${agent.id}`,
      name: agent.lastToolUse.name,
      input: agent.lastToolUse.input ?? {},
    };
  }

  // Extract completion report and parent agent from metadata if available
  const completionReport = (agent.metadata?.completionReport as string) || undefined;
  const parentAgentId = (agent.metadata?.createdByAgentId as string) || undefined;

  return {
    id: agent.id,
    name: agent.name || m.chat_chatHeader_newChat_fallback(),
    status: agent.status,
    lastUserMessage,
    lastResponse,
    lastToolUse,
    fileChanges: (agent.fileChanges || []).map((fc: any) => ({
      path: fc.path,
      action: fc.type || fc.action || 'modify',
      timestamp: fc.timestamp || new Date().toISOString(),
    })),
    messages: agent.messages || [],
    completionReport,
    digest,
    parentAgentId,
    lastMessageRole,
  };
}

/**
 * Truncate text to a specific number of lines
 * Skips trailing empty lines to avoid blank display
 */
export function truncateToLines(text: string, maxLines: number): string {
  if (!text) return '';

  // Split into lines and remove trailing empty lines
  const lines = text.split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  // If no non-empty lines, return empty
  if (lines.length === 0) return '';

  // Take last N lines
  if (lines.length <= maxLines) return lines.join('\n');
  return `${lines.slice(-maxLines).join('\n')}...`;
}
