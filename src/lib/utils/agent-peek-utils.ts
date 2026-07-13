/**
 * Agent Peek Utils
 *
 * Centralized utilities for extracting agent preview/peek data.
 * Used by AgentPeekCard and other components that need to display agent summaries.
 */

import type { AgentSession, AgentMessage, FileOperation, ToolUseBlock } from '$shared/types';
import { AuggieTextParser } from './auggie-text-parser';
import { stripGroupTags } from './text-utils';

export interface AgentPeekData {
  id: string;
  name: string;
  status: AgentSession['status'];
  lastUserMessage: string;
  lastResponse: string;
  /**
   * Latest tool_use block from the most recent assistant message when the
   * trailing meaningful block is a tool_use (i.e. after ignoring empty text
   * and tool_result blocks). Set even when the message has earlier text,
   * in which case `lastResponse` is cleared so consumers render the tool
   * icon/label preview instead of stale prior text.
   */
  lastToolUse?: ToolUseBlock;
  fileChanges: FileOperation[];
  messages: AgentMessage[];
  /** Completion report set via report_to_parent tool */
  completionReport?: string;
  /** Digest extracted from <agent_digest> tag in last message */
  digest?: string;
  /** ID of the parent agent that created this agent */
  parentAgentId?: string;
}

/**
 * Extract peek data from an agent session
 */
export function getAgentPeekData(agent: AgentSession | null | undefined): AgentPeekData | null {
  if (!agent) return null;

  // Extract last user message and last assistant response from messages array
  let lastUserMessage = '';
  let lastResponse = '';
  let lastToolUse: ToolUseBlock | undefined;
  let digest: string | undefined;

  if (agent.messages && agent.messages.length > 0) {
    // Find the last user message
    for (let i = agent.messages.length - 1; i >= 0; i--) {
      const msg = agent.messages[i];
      if (msg.role === 'user') {
        lastUserMessage = extractMessageText(msg);
        break;
      }
    }

    // Find the last assistant response and extract digest if present
    for (let i = agent.messages.length - 1; i >= 0; i--) {
      const msg = agent.messages[i];
      if (msg.role === 'assistant') {
        const fullText = extractMessageText(msg);
        // Try to extract <agent_digest> from the message
        const extracted = AuggieTextParser.extractDigest(fullText);
        if (extracted.digest) {
          digest = extracted.digest;
        }

        // Prefer previewing the latest block. If the assistant most recently
        // emitted a tool_use, surface it as the preview (consumers render a
        // proper tool icon) instead of the older text earlier in the message.
        const latest = getLatestMeaningfulBlock(msg);
        if (latest && (latest as any).type === 'tool_use') {
          lastToolUse = latest as ToolUseBlock;
          lastResponse = '';
        } else {
          lastResponse = extracted.digest ? extracted.cleanedText : fullText;
        }
        break;
      }
    }
  }

  // Extract completion report and parent agent from metadata if available
  const completionReport = (agent.metadata?.completionReport as string) || undefined;
  const parentAgentId = (agent.metadata?.createdByAgentId as string) || undefined;

  return {
    id: agent.id,
    name: agent.name || 'New Chat',
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
  };
}

/**
 * Extract text content from a message. Returns an empty string if the message
 * has no text blocks (callers can fall back to tool_use previews separately).
 */
function extractMessageText(msg: AgentMessage): string {
  if (msg.contentBlocks && Array.isArray(msg.contentBlocks)) {
    return stripGroupTags(
      msg.contentBlocks
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text || block.content || '')
        .join(' ')
        .trim(),
    );
  }
  return '';
}

/**
 * Return the most recent meaningful content block from a message, preferring
 * tool_use / non-empty text and skipping tool_result entries. Used to decide
 * whether the preview should render a tool icon or plain text.
 */
function getLatestMeaningfulBlock(msg: AgentMessage): unknown {
  if (!msg.contentBlocks || !Array.isArray(msg.contentBlocks)) return undefined;
  for (let i = msg.contentBlocks.length - 1; i >= 0; i--) {
    const block: any = msg.contentBlocks[i];
    if (block.type === 'tool_use') return block;
    if (block.type === 'text') {
      const text = (block.text || block.content || '').trim();
      if (text) return block;
    }
    // tool_result and empty text blocks are skipped
  }
  return undefined;
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

/**
 * Truncate text to a specific character length
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}...`;
}
