/**
 * Agent Peek Utils
 *
 * Centralized utilities for extracting agent preview/peek data.
 * Used by AgentPeekCard and other components that need to display agent summaries.
 */

import type { AgentSession, AgentMessage, FileOperation } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AuggieTextParser } from './auggie-text-parser';

export interface AgentPeekData {
  id: string;
  name: string;
  status: AgentStatus;
  isActive: boolean;
  isResponding: boolean;
  lastUserMessage: string;
  lastResponse: string;
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
          lastResponse = extracted.cleanedText;
        } else {
          lastResponse = fullText;
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
    isActive: agent.status === AgentStatus.Active,
    isResponding: agent.isProcessing || false,
    lastUserMessage,
    lastResponse,
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
 * Extract text content from a message
 * Handles ContentBlock arrays and includes tool calls when there's no text content
 */
function extractMessageText(msg: AgentMessage): string {
  if (msg.contentBlocks && Array.isArray(msg.contentBlocks)) {
    // Extract text from content blocks
    const textContent = msg.contentBlocks
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text || block.content || '')
      .join(' ')
      .trim();

    // If we have text content, return it
    if (textContent) {
      return textContent;
    }

    // Otherwise, look for tool use blocks and show them
    const toolUseBlocks = msg.contentBlocks.filter((block: any) => block.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
      const lastTool = toolUseBlocks[toolUseBlocks.length - 1];
      const toolName = lastTool.name || lastTool.toolName || 'tool';
      return `🔧 ${formatToolName(toolName)}`;
    }
  }
  return '';
}

/**
 * Format a tool name for display (snake_case to Title Case)
 */
function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
