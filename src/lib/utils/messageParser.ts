/**
 * Utilities for parsing and formatting agent messages
 * Handles mixed content like file operations, command outputs, and regular text
 *
 * ARCHITECTURE:
 * The message parsing pipeline works as follows:
 *
 * 1. Auggie CLI outputs text in streaming mode (character-by-character)
 * 2. AuggieTextParser (auggie-text-parser.ts) parses the raw text stream into:
 *    - ParsedContent[] with types: "text", "tool_use", "tool_result", "session_info", "error", "digest"
 *    - Filters out tool headers, markers, and system messages
 *    - Only emits clean, user-facing content
 * 3. cleanAgentMessage() performs final whitespace normalization
 *
 * KEY PRINCIPLE:
 * Tool artifacts (headers, parameters, markers) should be filtered by AuggieTextParser.
 * cleanAgentMessage() should only do basic whitespace cleanup, not complex filtering.
 * If tool content is leaking into messages, fix AuggieTextParser, not cleanAgentMessage.
 */

import { Logger } from '$shared/logger';
import type { SuggestedPrompt } from '$shared/types';
import type { ContentBlock } from '$shared/types/content-block';

const logger = new Logger('MessageParser');

export interface ParsedContent {
  type:
    | 'text'
    | 'code'
    | 'file'
    | 'command'
    | 'output'
    | 'error'
    | 'augment_code_snippet'
    | 'diff'
    | 'commit_message'
    | 'diagram'
    | 'digest'
    | 'mermaid'
    | 'workspace_card'
    | 'nav_link'
    | 'patch'
    | 'reference'
    | 'cli'
    | 'agent_action'
    | 'detected_scripts'
    | 'group_start'
    | 'group_end';
  content: string;
  metadata?: {
    language?: string;
    fileName?: string;
    command?: string;
    lineNumbers?: boolean;
    path?: string;
    mode?: string;
    diagramData?: unknown; // Parsed DiagramPrimitive data
    workspaceCardData?: { workspaceIds: string[] };
    navLinkData?: { target: string; label?: string };
    patchData?: { filePath: string; diff: string; description?: string }; // Parsed patch data
    referenceData?: {
      semanticId?: string;
      filePath?: string;
      description?: string;
      snapshot?: { code: string; filePath: string; languageId?: string };
    };
    cliData?: { command: string; description?: string; cwd?: string };
    agentActionData?: { agentId: string; goal: string; description?: string };
    detectedScriptsData?: Array<{
      name: string;
      command: string;
      mode: string;
      category?: string;
    }>;
    groupName?: string;
    isStreaming?: boolean;
  };
}

/**
 * Parse agent message content into structured blocks
 * Handles special Auggie formats like <augment_code_snippet> tags, diffs, and commit messages
 */
// PERF: Pre-compiled regex patterns for single-pass extraction
// Note: Closing fences MUST be line-anchored (start of line) per CommonMark spec
// to prevent matching fences within string literals or inline content.
// Separate patterns for backtick vs tilde fences to prevent mismatched fence types.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SPECIAL_BLOCK_PATTERNS = {
  // XML-style augment_code_snippet with 4+ backticks
  augmentSnippet:
    /<augment_code_snippet\s+path="([^"]+)"(?:\s+mode="([^"]+)")?\s*>\s*(`{4,})(\w+)?\s*\n([\s\S]*?)\n\s*\3\s*<\/augment_code_snippet>/gm,
  // Markdown 4+ backtick with path= attribute
  markdown4: /(`{4,})(\w+)?\s+path=([^\s]+)(?:\s+mode=([^\s\n]+))?\s*\n([\s\S]*?)^`{4,}\s*$/gm,
  // Markdown 3+ backtick with path= attribute
  markdown3: /(`{3,})(\w+)?\s+path=([^\s]+)(?:\s+mode=([^\s\n]+))?\s*\n([\s\S]*?)^`{3,}\s*$/gm,
  // Diff blocks - separate patterns for backtick vs tilde to prevent mismatch
  diff: /(?:(`{3,})diff\n([\s\S]*?)^`{3,}\s*$|(~{3,})diff\n([\s\S]*?)^~{3,}\s*$)/gm,
  // Commit messages
  commit: /<COMMIT_MESSAGE>([\s\S]*?)<\/COMMIT_MESSAGE>/g,
  // Diagram blocks - separate patterns for backtick vs tilde
  diagram:
    /(?:(`{3,})(?:diagram|ws-block:diagram)\s*\n([\s\S]*?)^`{3,}\s*$|(~{3,})(?:diagram|ws-block:diagram)\s*\n([\s\S]*?)^~{3,}\s*$)/gm,
  // Patch blocks - separate patterns for backtick vs tilde
  patch:
    /(?:(`{3,})ws-block:patch\s*\n([\s\S]*?)^`{3,}\s*$|(~{3,})ws-block:patch\s*\n([\s\S]*?)^~{3,}\s*$)/gm,
  // Reference blocks - separate patterns for backtick vs tilde
  reference:
    /(?:(`{3,})ws-block:reference\s*\n([\s\S]*?)^`{3,}\s*$|(~{3,})ws-block:reference\s*\n([\s\S]*?)^~{3,}\s*$)/gm,
  // CLI blocks - separate patterns for backtick vs tilde
  cli: /(?:(`{3,})ws-block:cli\s*\n([\s\S]*?)^`{3,}\s*$|(~{3,})ws-block:cli\s*\n([\s\S]*?)^~{3,}\s*$)/gm,
  // Agent action blocks - separate patterns for backtick vs tilde
  agentAction:
    /(?:(`{3,})ws-block:agent_action\s*\n([\s\S]*?)^`{3,}\s*$|(~{3,})ws-block:agent_action\s*\n([\s\S]*?)^~{3,}\s*$)/gm,
  // Mermaid diagram blocks - separate patterns for backtick vs tilde
  mermaid: /(?:(`{3,})mermaid\s*\n([\s\S]*?)^`{3,}\s*$|(~{3,})mermaid\s*\n([\s\S]*?)^~{3,}\s*$)/gm,
  // Nav-link blocks - separate patterns for backtick vs tilde
  navLink:
    // i18n-ignore (regex literal with backticks)
    /(?:(`{3,})nav-link\s*\n([\s\S]*?)^`{3,}\s*$|(~{3,})nav-link\s*\n([\s\S]*?)^~{3,}\s*$)/gm,
  // Workspace card blocks - @@@workspace sentinel syntax
  workspaceSentinel: /^@@@workspace[ \t]*\n([\s\S]*?)^@@@[ \t]*$/gm,
  // Agent digest - short summary for display
  agentDigest: /<agent_digest>([\s\S]*?)<\/agent_digest>/g,
  // Detected scripts from background agent
  detectedScripts: /<<<DETECTED_SCRIPTS>>>([\s\S]*?)<<<\/DETECTED_SCRIPTS>>>/g,
};

// PERF: Combined regex for single-pass special block detection
// This finds all special blocks in one pass through the content
// Closing fences are line-anchored (^) with multiline flag to prevent matching within content.
// Separate branches for backtick vs tilde fences to prevent mismatched fence types.
const COMBINED_SPECIAL_REGEX =
  /(<augment_code_snippet\s+path="[^"]+"(?:\s+mode="[^"]+")?\s*>\s*(`{4,})\w*\s*\n[\s\S]*?\n\s*\2\s*<\/augment_code_snippet>|(`{4,})\w*\s+path=[^\s]+(?:\s+mode=[^\s\n]+)?\s*\n[\s\S]*?^`{4,}\s*$|(`{3,})\w*\s+path=[^\s]+(?:\s+mode=[^\s\n]+)?\s*\n[\s\S]*?^`{3,}\s*$|(?:`{3,}diff\n[\s\S]*?^`{3,}\s*$|~{3,}diff\n[\s\S]*?^~{3,}\s*$)|<COMMIT_MESSAGE>[\s\S]*?<\/COMMIT_MESSAGE>|(?:`{3,}(?:diagram|ws-block:diagram)\s*\n[\s\S]*?^`{3,}\s*$|~{3,}(?:diagram|ws-block:diagram)\s*\n[\s\S]*?^~{3,}\s*$)|(?:`{3,}ws-block:patch\s*\n[\s\S]*?^`{3,}\s*$|~{3,}ws-block:patch\s*\n[\s\S]*?^~{3,}\s*$)|(?:`{3,}ws-block:reference\s*\n[\s\S]*?^`{3,}\s*$|~{3,}ws-block:reference\s*\n[\s\S]*?^~{3,}\s*$)|(?:`{3,}ws-block:cli\s*\n[\s\S]*?^`{3,}\s*$|~{3,}ws-block:cli\s*\n[\s\S]*?^~{3,}\s*$)|(?:`{3,}ws-block:agent_action\s*\n[\s\S]*?^`{3,}\s*$|~{3,}ws-block:agent_action\s*\n[\s\S]*?^~{3,}\s*$)|^@@@workspace[ \t]*\n[\s\S]*?^@@@[ \t]*$|(?:`{3,}nav-link\s*\n[\s\S]*?^`{3,}\s*$|~{3,}nav-link\s*\n[\s\S]*?^~{3,}\s*$)|(?:`{3,}mermaid\s*\n[\s\S]*?^`{3,}\s*$|~{3,}mermaid\s*\n[\s\S]*?^~{3,}\s*$)|<agent_digest>[\s\S]*?<\/agent_digest>|<<<DETECTED_SCRIPTS>>>[\s\S]*?<<<\/DETECTED_SCRIPTS>>>)/gm;

const WORKSPACE_LINK_PREFIX = 'intent://local/workspace/';

function parseWorkspaceCardIds(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .map((line) => {
      const backtickMatch = line.match(/^`+([\s\S]*?)`+$/);
      return (backtickMatch?.[1] ?? line).trim();
    })
    .map((line) => {
      if (line.startsWith(WORKSPACE_LINK_PREFIX)) {
        return line.slice(WORKSPACE_LINK_PREFIX.length).trim();
      }
      return line;
    })
    .filter(Boolean);
}

function parseNavLinkBody(body: string): { target: string; label?: string } | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  // JSON form: {"target":"...", "label":"..."}
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const target = typeof parsed?.target === 'string' ? parsed.target.trim() : '';
      if (!target) return null;
      const label = typeof parsed?.label === 'string' ? parsed.label.trim() : undefined;
      return label ? { target, label } : { target };
    } catch {
      return null;
    }
  }

  // Shorthand form: "target | label" or just "target" (one per line, first line wins)
  const firstLine = trimmed.split('\n')[0].trim();
  if (!firstLine) return null;
  const pipeIdx = firstLine.indexOf('|');
  if (pipeIdx === -1) return { target: firstLine };
  const target = firstLine.slice(0, pipeIdx).trim();
  const label = firstLine.slice(pipeIdx + 1).trim();
  if (!target) return null;
  return label ? { target, label } : { target };
}

/**
 * Parse a single special block match into a ParsedContent
 * PERF: Avoids re-running regex on the full content
 */
function parseSpecialBlock(blockText: string): ParsedContent | null {
  // Check augment_code_snippet first (most specific)
  if (blockText.startsWith('<augment_code_snippet')) {
    const match = blockText.match(
      /<augment_code_snippet\s+path="([^"]+)"(?:\s+mode="([^"]+)")?\s*>\s*(`{4,})(\w+)?\s*\n([\s\S]*?)\n\s*\3\s*<\/augment_code_snippet>/m,
    );
    if (match) {
      return {
        type: 'augment_code_snippet',
        content: match[5].trim(),
        metadata: {
          path: match[1],
          mode: match[2] || 'EXCERPT',
          language: match[4] || 'plaintext',
        },
      };
    }
  }

  // Check 4+ backtick markdown with path
  if (/^`{4,}/.test(blockText)) {
    const match = blockText.match(
      /(`{4,})(\w+)?\s+path=([^\s]+)(?:\s+mode=([^\s\n]+))?\s*\n([\s\S]*?)^`{4,}\s*$/m,
    );
    if (match) {
      return {
        type: 'augment_code_snippet',
        content: match[5].trim(),
        metadata: {
          path: match[3] || '',
          mode: match[4] || 'EXCERPT',
          language: match[2] || 'plaintext',
        },
      };
    }
  }

  // Check 3+ backtick markdown with path (but not diff, diagram, ws-block, nav-link, or mermaid)
  if (
    /^`{3,}/.test(blockText) &&
    !/^`{3,}(?:diff|diagram|ws-block:|nav-link|mermaid)/.test(blockText)
  ) {
    const match = blockText.match(
      /(`{3,})(\w+)?\s+path=([^\s]+)(?:\s+mode=([^\s\n]+))?\s*\n([\s\S]*?)^`{3,}\s*$/m,
    );
    if (match) {
      return {
        type: 'augment_code_snippet',
        content: match[5].trim(),
        metadata: {
          path: match[3] || '',
          mode: match[4] || 'EXCERPT',
          language: match[2] || 'plaintext',
        },
      };
    }
  }

  // Check diff block - separate patterns for backtick vs tilde
  if (/^`{3,}diff/.test(blockText)) {
    const match = blockText.match(/`{3,}diff\n([\s\S]*?)^`{3,}\s*$/m);
    if (match) {
      return {
        type: 'diff',
        content: match[1].trim(),
      };
    }
  }
  if (/^~{3,}diff/.test(blockText)) {
    const match = blockText.match(/~{3,}diff\n([\s\S]*?)^~{3,}\s*$/m);
    if (match) {
      return {
        type: 'diff',
        content: match[1].trim(),
      };
    }
  }

  // Check commit message
  if (blockText.startsWith('<COMMIT_MESSAGE>')) {
    const match = blockText.match(/<COMMIT_MESSAGE>([\s\S]*?)<\/COMMIT_MESSAGE>/);
    if (match) {
      return {
        type: 'commit_message',
        content: match[1].trim(),
      };
    }
  }

  // Check patch block - separate patterns for backtick vs tilde
  if (/^`{3,}ws-block:patch/.test(blockText)) {
    const match = blockText.match(/`{3,}ws-block:patch\s*\n([\s\S]*?)^`{3,}\s*$/m);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        // Try parsing as-is first, then fall back to escaping literal newlines.
        // The diff field often contains literal newline characters (from the agent's
        // raw output) which are invalid inside JSON string values.
        let patchJson;
        try {
          patchJson = JSON.parse(jsonContent);
        } catch {
          const sanitizedJson = jsonContent
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          patchJson = JSON.parse(sanitizedJson);
        }

        // Support both formats:
        // 1. Simplified: { target: { filePath, diff, description } }
        // 2. Standard PatchPrimitive: { type: 'patch', patches: [{ filePath, diff }], label }
        let filePath = '';
        let diff = '';
        let description = '';

        if (patchJson.target) {
          filePath = patchJson.target.filePath || '';
          diff = patchJson.target.diff || '';
          description = patchJson.target.description || patchJson.description || '';
        } else if (patchJson.patches && patchJson.patches.length > 0) {
          filePath = patchJson.patches[0].filePath || '';
          diff = patchJson.patches[0].diff || '';
          description = patchJson.label || patchJson.description || '';
        } else {
          // Flat format: { filePath, diff, description }
          filePath = patchJson.filePath || '';
          diff = patchJson.diff || '';
          description = patchJson.description || patchJson.label || '';
        }

        return {
          type: 'patch',
          content: diff,
          metadata: {
            path: filePath,
            patchData: { filePath, diff, description },
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse patch JSON:', e);
        return {
          type: 'text',
          content: blockText,
        };
      }
    }
  }
  if (/^~{3,}ws-block:patch/.test(blockText)) {
    const match = blockText.match(/~{3,}ws-block:patch\s*\n([\s\S]*?)^~{3,}\s*$/m);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        // Try parsing as-is first, then fall back to escaping literal newlines.
        // The diff field often contains literal newline characters (from the agent's
        // raw output) which are invalid inside JSON string values.
        let patchJson;
        try {
          patchJson = JSON.parse(jsonContent);
        } catch {
          const sanitizedJson = jsonContent
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          patchJson = JSON.parse(sanitizedJson);
        }

        // Support both formats:
        // 1. Simplified: { target: { filePath, diff, description } }
        // 2. Standard PatchPrimitive: { type: 'patch', patches: [{ filePath, diff }], label }
        let filePath = '';
        let diff = '';
        let description = '';

        if (patchJson.target) {
          filePath = patchJson.target.filePath || '';
          diff = patchJson.target.diff || '';
          description = patchJson.target.description || patchJson.description || '';
        } else if (patchJson.patches && patchJson.patches.length > 0) {
          filePath = patchJson.patches[0].filePath || '';
          diff = patchJson.patches[0].diff || '';
          description = patchJson.label || patchJson.description || '';
        } else {
          // Flat format: { filePath, diff, description }
          filePath = patchJson.filePath || '';
          diff = patchJson.diff || '';
          description = patchJson.description || patchJson.label || '';
        }

        return {
          type: 'patch',
          content: diff,
          metadata: {
            path: filePath,
            patchData: { filePath, diff, description },
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse patch JSON:', e);
        return {
          type: 'text',
          content: blockText,
        };
      }
    }
  }

  // Check reference block - separate patterns for backtick vs tilde
  if (/^`{3,}ws-block:reference/.test(blockText)) {
    const match = blockText.match(/`{3,}ws-block:reference\s*\n([\s\S]*?)^`{3,}\s*$/m);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        let refJson;
        try {
          refJson = JSON.parse(jsonContent);
        } catch {
          const sanitizedJson = jsonContent
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          refJson = JSON.parse(sanitizedJson);
        }

        const semanticId = refJson.target?.semanticId || refJson.semanticId || '';
        const filePath =
          refJson.target?.filePath || refJson.filePath || semanticId?.split('#')[0] || '';
        const description = refJson.description || '';
        const snapshot = refJson.snapshot || undefined;

        return {
          type: 'reference',
          content: description || semanticId || filePath,
          metadata: {
            path: filePath,
            referenceData: { semanticId, filePath, description, snapshot },
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse reference JSON:', e);
        return { type: 'text', content: blockText };
      }
    }
  }
  if (/^~{3,}ws-block:reference/.test(blockText)) {
    const match = blockText.match(/~{3,}ws-block:reference\s*\n([\s\S]*?)^~{3,}\s*$/m);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        let refJson;
        try {
          refJson = JSON.parse(jsonContent);
        } catch {
          const sanitizedJson = jsonContent
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          refJson = JSON.parse(sanitizedJson);
        }

        const semanticId = refJson.target?.semanticId || refJson.semanticId || '';
        const filePath =
          refJson.target?.filePath || refJson.filePath || semanticId?.split('#')[0] || '';
        const description = refJson.description || '';
        const snapshot = refJson.snapshot || undefined;

        return {
          type: 'reference',
          content: description || semanticId || filePath,
          metadata: {
            path: filePath,
            referenceData: { semanticId, filePath, description, snapshot },
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse reference JSON:', e);
        return { type: 'text', content: blockText };
      }
    }
  }

  // Check CLI block - separate patterns for backtick vs tilde
  if (/^`{3,}ws-block:cli/.test(blockText)) {
    const match = blockText.match(/`{3,}ws-block:cli\s*\n([\s\S]*?)^`{3,}\s*$/m);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        let cliJson;
        try {
          cliJson = JSON.parse(jsonContent);
        } catch {
          const sanitizedJson = jsonContent
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          cliJson = JSON.parse(sanitizedJson);
        }

        const command = cliJson.command || '';
        const description = cliJson.description || '';
        const cwd = cliJson.cwd || undefined;

        return {
          type: 'cli',
          content: command,
          metadata: {
            cliData: { command, description, cwd },
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse CLI JSON:', e);
        return { type: 'text', content: blockText };
      }
    }
  }
  if (/^~{3,}ws-block:cli/.test(blockText)) {
    const match = blockText.match(/~{3,}ws-block:cli\s*\n([\s\S]*?)^~{3,}\s*$/m);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        let cliJson;
        try {
          cliJson = JSON.parse(jsonContent);
        } catch {
          const sanitizedJson = jsonContent
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          cliJson = JSON.parse(sanitizedJson);
        }

        const command = cliJson.command || '';
        const description = cliJson.description || '';
        const cwd = cliJson.cwd || undefined;

        return {
          type: 'cli',
          content: command,
          metadata: {
            cliData: { command, description, cwd },
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse CLI JSON:', e);
        return { type: 'text', content: blockText };
      }
    }
  }

  // Check agent action block - separate patterns for backtick vs tilde
  if (/^`{3,}ws-block:agent_action/.test(blockText)) {
    const match = blockText.match(/`{3,}ws-block:agent_action\s*\n([\s\S]*?)^`{3,}\s*$/m);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        let actionJson;
        try {
          actionJson = JSON.parse(jsonContent);
        } catch {
          const sanitizedJson = jsonContent
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          actionJson = JSON.parse(sanitizedJson);
        }

        const agentId = actionJson.agentId || '';
        const goal = actionJson.goal || '';
        const description = actionJson.description || '';

        return {
          type: 'agent_action',
          content: goal,
          metadata: {
            agentActionData: { agentId, goal, description },
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse agent action JSON:', e);
        return { type: 'text', content: blockText };
      }
    }
  }
  if (/^~{3,}ws-block:agent_action/.test(blockText)) {
    const match = blockText.match(/~{3,}ws-block:agent_action\s*\n([\s\S]*?)^~{3,}\s*$/m);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        let actionJson;
        try {
          actionJson = JSON.parse(jsonContent);
        } catch {
          const sanitizedJson = jsonContent
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          actionJson = JSON.parse(sanitizedJson);
        }

        const agentId = actionJson.agentId || '';
        const goal = actionJson.goal || '';
        const description = actionJson.description || '';

        return {
          type: 'agent_action',
          content: goal,
          metadata: {
            agentActionData: { agentId, goal, description },
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse agent action JSON:', e);
        return { type: 'text', content: blockText };
      }
    }
  }

  // Check @@@workspace sentinel block
  if (blockText.startsWith('@@@workspace')) {
    const match = blockText.match(/^@@@workspace[ \t]*\n([\s\S]*?)^@@@[ \t]*$/m);
    if (match) {
      const workspaceIds = parseWorkspaceCardIds(match[1]);
      if (workspaceIds.length === 0) {
        return { type: 'text', content: blockText };
      }

      return {
        type: 'workspace_card',
        content: match[1],
        metadata: {
          workspaceCardData: { workspaceIds },
        },
      };
    }
  }

  // Check nav-link block - separate patterns for backtick vs tilde
  if (/^`{3,}nav-link/.test(blockText)) {
    const match = blockText.match(/`{3,}nav-link\s*\n([\s\S]*?)^`{3,}\s*$/m);
    if (match) {
      const parsed = parseNavLinkBody(match[1]);
      if (!parsed) return { type: 'text', content: blockText };
      return {
        type: 'nav_link',
        content: parsed.label ?? parsed.target,
        metadata: { navLinkData: parsed },
      };
    }
  }
  if (/^~{3,}nav-link/.test(blockText)) {
    const match = blockText.match(/~{3,}nav-link\s*\n([\s\S]*?)^~{3,}\s*$/m);
    if (match) {
      const parsed = parseNavLinkBody(match[1]);
      if (!parsed) return { type: 'text', content: blockText };
      return {
        type: 'nav_link',
        content: parsed.label ?? parsed.target,
        metadata: { navLinkData: parsed },
      };
    }
  }

  // Check diagram block - separate patterns for backtick vs tilde
  if (/^`{3,}(?:diagram|ws-block:diagram)/.test(blockText)) {
    const match = blockText.match(/`{3,}(?:diagram|ws-block:diagram)\s*\n([\s\S]*?)^`{3,}\s*$/m);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        const diagramData = JSON.parse(jsonContent);
        return {
          type: 'diagram',
          content: jsonContent,
          metadata: {
            diagramData,
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse diagram JSON:', e);
        // Return as text if JSON parsing fails
        return {
          type: 'text',
          content: blockText,
        };
      }
    }
  }
  if (/^~{3,}(?:diagram|ws-block:diagram)/.test(blockText)) {
    const match = blockText.match(/~{3,}(?:diagram|ws-block:diagram)\s*\n([\s\S]*?)^~{3,}\s*$/m);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        const diagramData = JSON.parse(jsonContent);
        return {
          type: 'diagram',
          content: jsonContent,
          metadata: {
            diagramData,
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse diagram JSON:', e);
        // Return as text if JSON parsing fails
        return {
          type: 'text',
          content: blockText,
        };
      }
    }
  }

  // Check mermaid block - separate patterns for backtick vs tilde
  if (/^`{3,}mermaid/.test(blockText)) {
    const match = blockText.match(/`{3,}mermaid\s*\n([\s\S]*?)^`{3,}\s*$/m);
    if (match) {
      return {
        type: 'mermaid',
        content: match[1].trim(),
      };
    }
  }
  if (/^~{3,}mermaid/.test(blockText)) {
    const match = blockText.match(/~{3,}mermaid\s*\n([\s\S]*?)^~{3,}\s*$/m);
    if (match) {
      return {
        type: 'mermaid',
        content: match[1].trim(),
      };
    }
  }

  // Check agent digest block
  if (blockText.startsWith('<agent_digest>')) {
    const match = blockText.match(/<agent_digest>([\s\S]*?)<\/agent_digest>/);
    if (match) {
      const digestContent = match[1].trim();
      if (digestContent) {
        return {
          type: 'digest',
          content: digestContent,
        };
      }
    }
  }

  // Check detected scripts block
  if (blockText.startsWith('<<<DETECTED_SCRIPTS>>>')) {
    const match = blockText.match(/<<<DETECTED_SCRIPTS>>>([\s\S]*?)<<<\/DETECTED_SCRIPTS>>>/);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        const scriptsData = JSON.parse(jsonContent);
        // Support both flat array format and object format with add/update/remove
        const scriptsArray = Array.isArray(scriptsData)
          ? scriptsData
          : scriptsData && typeof scriptsData === 'object' && Array.isArray(scriptsData.add)
            ? scriptsData.add
            : null;
        if (scriptsArray) {
          return {
            type: 'detected_scripts',
            content: jsonContent,
            metadata: {
              detectedScriptsData: scriptsArray,
            },
          };
        }
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse detected scripts JSON:', e);
        return { type: 'text', content: blockText };
      }
    }
  }

  return null;
}

export function parseAgentMessage(content: string): ParsedContent[] {
  if (!content) return [];

  // PERF: Single-pass extraction of all special blocks
  // Instead of running 5 separate regex passes, we find all special blocks at once
  const specialBlocks: Array<{ start: number; end: number; block: ParsedContent }> = [];

  // Reset regex state
  COMBINED_SPECIAL_REGEX.lastIndex = 0;

  let match;
  while ((match = COMBINED_SPECIAL_REGEX.exec(content)) !== null) {
    const blockText = match[0];
    const parsed = parseSpecialBlock(blockText);
    if (parsed) {
      specialBlocks.push({
        start: match.index,
        end: match.index + blockText.length,
        block: parsed,
      });
    }
  }

  // PERF: Build result array directly without placeholder replacement
  // This avoids multiple string.replace() calls which are O(n) each
  if (specialBlocks.length === 0) {
    // No special blocks - process as regular content
    return processRegularContent(content);
  }

  // Sort by position (should already be sorted, but ensure)
  specialBlocks.sort((a, b) => a.start - b.start);

  const result: ParsedContent[] = [];
  let lastEnd = 0;

  for (const { start, end, block } of specialBlocks) {
    // Add text content before this special block
    if (start > lastEnd) {
      const textBefore = content.slice(lastEnd, start);
      const textBlocks = processRegularContent(textBefore);
      result.push(...textBlocks);
    }

    // Add the special block
    result.push(block);
    lastEnd = end;
  }

  // Add any remaining text after the last special block
  if (lastEnd < content.length) {
    const textAfter = content.slice(lastEnd);
    const textBlocks = processRegularContent(textAfter);
    result.push(...textBlocks);
  }

  // Merge consecutive text blocks
  const merged = mergeConsecutiveTextBlocks(result);

  return merged;
}

/**
 * Process regular content (non-special blocks) into ParsedContent[]
 * PERF: Extracted to avoid code duplication and enable early returns
 */
// PERF: Pre-compiled patterns for line processing (avoid re-creating on each call)
const LINE_PATTERNS = {
  // File content with line numbers (e.g., "1→content" or "   1	content")
  fileWithLineNumbers: /^\s*\d+[→\t]/,
  // Command execution
  command: /^\$\s+(.+)$/,
  commandAlt: /^>\s+(.+)$/,
  // Error messages
  error: /^(error|Error|ERROR)[\s:]/i,
  warning: /^(warning|Warning|WARNING)[\s:]/i,
  // Common file operation outputs
  fileOperation: /^(Created|Updated|Deleted|Modified|Reading|Writing|Editing)\s+/i,
};

function processRegularContent(content: string): ParsedContent[] {
  if (!content.trim()) return [];

  const blocks: ParsedContent[] = [];
  const lines = content.split('\n');
  let currentBlock: ParsedContent | null = null;
  let blockLines: string[] = [];

  function flushBlock() {
    if (currentBlock && blockLines.length > 0) {
      currentBlock.content = blockLines.join('\n').trim();
      if (currentBlock.content) {
        blocks.push(currentBlock);
      }
    }
    currentBlock = null;
    blockLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Skip empty lines between blocks
    if (!trimmedLine && !currentBlock) {
      continue;
    }

    // Check for file content with line numbers
    if (LINE_PATTERNS.fileWithLineNumbers.test(line)) {
      if (currentBlock?.type !== 'file') {
        flushBlock();
        currentBlock = {
          type: 'file',
          content: '',
          metadata: { lineNumbers: true },
        };
      }
      blockLines.push(line);
      continue;
    }

    // Check for command execution
    const commandMatch = line.match(LINE_PATTERNS.command) || line.match(LINE_PATTERNS.commandAlt);
    if (commandMatch) {
      flushBlock();
      currentBlock = {
        type: 'command',
        content: '',
        metadata: { command: commandMatch[1] },
      };
      blockLines.push(commandMatch[1]);
      continue;
    }

    // Check for errors or warnings
    if (LINE_PATTERNS.error.test(trimmedLine)) {
      if (currentBlock?.type !== 'error') {
        flushBlock();
        currentBlock = { type: 'error', content: '' };
      }
      blockLines.push(line);
      continue;
    }

    if (LINE_PATTERNS.warning.test(trimmedLine)) {
      if (currentBlock?.type !== 'error') {
        flushBlock();
        currentBlock = { type: 'error', content: '' };
      }
      blockLines.push(line);
      continue;
    }

    // Check for code blocks (including indented code fences for list items)
    // Match ``` or ~~~ (>= 3 chars) at start of line OR with leading whitespace (for nested code blocks in lists)
    const codeFenceMatch = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (codeFenceMatch) {
      flushBlock();
      const openFence = codeFenceMatch[2]; // Full opening fence (e.g., "````" or "~~~")
      const fenceChar = openFence[0]; // Get the fence character (` or ~)
      const openFenceLength = openFence.length; // Number of fence characters
      const lang = codeFenceMatch[3].trim();
      currentBlock = {
        type: 'code',
        content: '',
        metadata: { language: lang || 'plaintext' },
      };

      // Find the closing fence (must have at least the same number of fence chars and same fence character)
      i++;
      while (i < lines.length) {
        const closingMatch = lines[i].match(/^(\s*)(`{3,}|~{3,})\s*$/);
        if (
          closingMatch &&
          closingMatch[2][0] === fenceChar &&
          closingMatch[2].length >= openFenceLength
        ) {
          // Found closing fence with matching fence character and sufficient length
          break;
        }
        blockLines.push(lines[i]);
        i++;
      }
      flushBlock();
      continue;
    }

    // Check for file operations
    if (LINE_PATTERNS.fileOperation.test(trimmedLine)) {
      if (currentBlock?.type !== 'output') {
        flushBlock();
        currentBlock = { type: 'output', content: '' };
      }
      blockLines.push(line);
      continue;
    }

    // Default to text or continue current block
    if (!currentBlock) {
      currentBlock = { type: 'text', content: '' };
    }
    blockLines.push(line);
  }

  // Flush any remaining block
  flushBlock();

  return blocks;
}

/**
 * Merge consecutive text blocks into single blocks
 * PERF: Extracted for reuse and clarity
 */
function mergeConsecutiveTextBlocks(blocks: ParsedContent[]): ParsedContent[] {
  if (blocks.length <= 1) return blocks;

  const merged: ParsedContent[] = [];
  for (const block of blocks) {
    const lastBlock = merged[merged.length - 1];
    if (lastBlock?.type === 'text' && block.type === 'text') {
      // i18n-ignore (whitespace-only template literal)
      lastBlock.content += `\n\n${block.content}`;
    } else {
      merged.push(block);
    }
  }
  return merged;
}

// Combined pattern to find any group tag (open or close) in a single pass
// Note: Group name capture uses [^>\n<]+ to avoid capturing across newlines or into
// nested tags like <think> that may appear immediately after the group name.
// The second alternative (<group:([^<\n]+)\n) handles malformed tags without closing >
// (e.g., "<group:Prepping\n<think>..." where the model omits the closing bracket).

// Combined pattern to find group tags AND think tags in a single pass.
// Think tags are used by some external providers (e.g., opencode) that embed
// model thinking directly in text rather than as separate thinking content blocks.
// Supports both <think>/<thinking> variants (different models use different tags).
// Pattern priority (left to right):
//   1. <group:Name> — standard group open
//   2. <group:Name\n — malformed group open (missing closing >)
//   3. </group:Name> or </group> — group close
//   4. <think> or <thinking> — think open
//   5. </think> or </thinking> — think close
const GROUP_AND_THINK_TAG_REGEX =
  /<group:([^>\n<]+)>|<group:([^\n<]+)\n|<\/group(?::([^>\n<]+))?>|<think(?:ing)?>|<\/think(?:ing)?>/g;

/**
 * Post-processing step: extract group markers from text blocks.
 * Scans text blocks for group open tags and group close tags,
 * splitting them into separate group_start / group_end entries.
 *
 * Handles the streaming case: if the last group_start has no matching group_end,
 * it is marked with metadata.isStreaming = true.
 */

/**
 * Grouped block structure for rendering.
 * Wraps content between group_start and group_end markers.
 */
export interface GroupedBlock {
  type: 'group';
  name: string;
  isStreaming: boolean;
  children: ParsedContent[];
}

export type RenderBlock = ParsedContent | GroupedBlock;

/**
 * Transform a flat ParsedContent[] (with group_start/group_end markers) into a
 * tree structure where grouped content is nested inside GroupedBlock objects.
 *
 * - Content between group_start and group_end is wrapped in a GroupedBlock
 * - Content outside groups passes through as-is
 * - Unclosed groups (streaming) are still wrapped, with isStreaming: true
 * - group_start and group_end markers themselves are consumed (not in output)
 */
export function groupParsedBlocks(blocks: ParsedContent[]): RenderBlock[] {
  const result: RenderBlock[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type === 'group_start') {
      const groupName = block.metadata?.groupName || '';
      const isStreaming = block.metadata?.isStreaming || false;
      const children: ParsedContent[] = [];
      i++; // skip the group_start marker

      // Collect children until we find a matching group_end or run out of blocks
      while (i < blocks.length && blocks[i].type !== 'group_end') {
        // If we hit another group_start, the previous group auto-closes (flat groups only)
        if (blocks[i].type === 'group_start') {
          break;
        }
        children.push(blocks[i]);
        i++;
      }

      // Skip the group_end marker if present
      if (i < blocks.length && blocks[i].type === 'group_end') {
        i++;
      }

      result.push({
        type: 'group',
        name: groupName,
        isStreaming,
        children,
      });
    } else if (block.type === 'group_end') {
      // Stray group_end without a matching group_start — skip it
      i++;
    } else {
      result.push(block);
      i++;
    }
  }

  return result;
}

function workspaceCardIsCoveredByIds(block: ParsedContent, ids: ReadonlySet<string>): boolean {
  if (block.type !== 'workspace_card') return false;
  const workspaceIds = block.metadata?.workspaceCardData?.workspaceIds ?? [];
  return workspaceIds.length > 0 && workspaceIds.every((workspaceId) => ids.has(workspaceId));
}

/**
 * Remove workspace cards that would duplicate a proposal card in the same message.
 * Workspace proposals already include the affected workspace titles and IDs, so rendering a
 * second workspace summary card immediately below them is redundant.
 */
export function filterWorkspaceCardsCoveredByIds(
  blocks: RenderBlock[],
  ids: ReadonlySet<string>,
): RenderBlock[] {
  if (ids.size === 0) return blocks;

  const result: RenderBlock[] = [];
  blocks.forEach((block) => {
    if (block.type === 'workspace_card' && workspaceCardIsCoveredByIds(block, ids)) {
      return;
    }

    if (block.type === 'group') {
      const children = block.children.filter((child) => !workspaceCardIsCoveredByIds(child, ids));
      if (children.length > 0) result.push({ ...block, children });
      return;
    }

    result.push(block);
  });
  return result;
}

/**
 * Grouped content block structure for rendering at the ContentBlock level.
 * Wraps ContentBlocks that appear between group open and group close tags.
 */
export interface ContentBlockGroup {
  type: 'content_group';
  name: string;
  isStreaming: boolean;
  children: ContentBlock[];
}

export type RenderContentBlock = ContentBlock | ContentBlockGroup;

/**
 * Group ContentBlocks that appear between group open and group close tags
 * found in text-type ContentBlocks.
 *
 * This operates at the ContentBlock[] level (not ParsedContent[]), grouping
 * tool_use, tool_result, thinking, and text blocks that appear between
 * group open/close tags.
 *
 * Algorithm:
 * 1. Walk through ContentBlocks in order
 * 2. When a text block contains a group open tag, split text and start collecting
 * 3. All subsequent blocks go inside the group
 * 4. When a group close tag is found, split text and close the group
 * 5. If a new group opens while another is open, auto-close the previous
 * 6. Unclosed groups: isStreaming param controls the isStreaming flag
 */
export function groupContentBlocks(
  blocks: ContentBlock[],
  isStreaming?: boolean,
): RenderContentBlock[] {
  const result: RenderContentBlock[] = [];
  let currentGroup: ContentBlockGroup | null = null;

  function closeCurrentGroup() {
    if (currentGroup) {
      result.push(currentGroup);
      currentGroup = null;
    }
  }

  function addBlock(block: ContentBlock) {
    if (currentGroup) {
      currentGroup.children.push(block);
    } else {
      result.push(block);
    }
  }

  function addTextIfNonEmpty(text: string) {
    const trimmed = text.trim();
    if (trimmed) {
      addBlock({ type: 'text', text: trimmed } as ContentBlock);
    }
  }

  // Track think state across text blocks (think tags can span multiple blocks
  // when tool_use/tool_result blocks appear between <think> and </think>)
  let insideThink = false;
  let thinkContent = '';

  function flushThinkContent() {
    if (insideThink) {
      const trimmedThink = thinkContent.trim();
      if (trimmedThink) {
        addBlock({ type: 'thinking', content: trimmedThink } as ContentBlock);
      }
      insideThink = false;
      thinkContent = '';
    }
  }

  for (const block of blocks) {
    // Only scan text blocks for group tags and think tags
    const blockText = block.type === 'text' ? (block.text ?? block.content ?? '') : '';

    if (block.type !== 'text' || !blockText) {
      // Non-text block or empty text block — pass through into current context
      if (block.type !== 'text') {
        // If we're inside a think block and hit a non-text block (e.g. tool_use),
        // flush the think content accumulated so far, then pass the block through.
        // The think "context" doesn't survive across non-text blocks.
        if (insideThink) {
          flushThinkContent();
        }
        addBlock(block);
      }
      continue;
    }

    // Scan this text block for group tags and think tags
    GROUP_AND_THINK_TAG_REGEX.lastIndex = 0;
    let lastIndex = 0;
    let match;
    let hasTags = insideThink; // if we're continuing a think from a previous block, mark as having tags

    while ((match = GROUP_AND_THINK_TAG_REGEX.exec(blockText)) !== null) {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;
      const matchStr = match[0];

      if (matchStr === '<think>' || matchStr === '<thinking>') {
        hasTags = true;
        // Text before <think>/<thinking> tag
        if (matchStart > lastIndex) {
          addTextIfNonEmpty(blockText.slice(lastIndex, matchStart));
        }
        insideThink = true;
        thinkContent = '';
        lastIndex = matchEnd;
      } else if (matchStr === '</think>' || matchStr === '</thinking>') {
        hasTags = true;
        if (insideThink) {
          // Collect content between <think> and </think>
          thinkContent += blockText.slice(lastIndex, matchStart);
          const trimmedThink = thinkContent.trim();
          if (trimmedThink) {
            addBlock({ type: 'thinking', content: trimmedThink } as ContentBlock);
          }
          insideThink = false;
          thinkContent = '';
        } else {
          // Stray </think> without opening tag — add text before it, then consume the tag
          if (matchStart > lastIndex) {
            addTextIfNonEmpty(blockText.slice(lastIndex, matchStart));
          }
        }
        lastIndex = matchEnd;
      } else if (insideThink) {
        // Inside a think block — group/close-group tags are part of thinking content, skip them
        continue;
      } else if (match[1] !== undefined || match[2] !== undefined) {
        // Open tag: <group:Name> (match[1]) or malformed <group:Name\n (match[2])
        const groupName = (match[1] || match[2] || '').trim();
        hasTags = true;
        if (matchStart > lastIndex) {
          addTextIfNonEmpty(blockText.slice(lastIndex, matchStart));
        }
        // Auto-close previous group if one is open
        if (currentGroup) {
          currentGroup.isStreaming = false;
          closeCurrentGroup();
        }
        currentGroup = {
          type: 'content_group',
          name: groupName,
          isStreaming: !!isStreaming, // default based on param; will be set to false on close
          children: [],
        };
        lastIndex = matchEnd;
      } else {
        // Close tag: </group:Name> or </group>
        hasTags = true;
        if (matchStart > lastIndex) {
          addTextIfNonEmpty(blockText.slice(lastIndex, matchStart));
        }
        if (currentGroup) {
          currentGroup.isStreaming = false;
          closeCurrentGroup();
        }
        // If no group is open, stray close tag is silently consumed
        lastIndex = matchEnd;
      }
    }

    // Handle unclosed <think> tag at end of this text block
    if (insideThink) {
      // Accumulate remaining text — the closing </think> may be in a later block
      thinkContent += blockText.slice(lastIndex);
      lastIndex = blockText.length;
    }

    if (!hasTags) {
      // No group/think tags in this text block — pass through as-is
      addBlock(block);
    } else {
      // Add any remaining text after the last tag
      if (lastIndex < blockText.length) {
        addTextIfNonEmpty(blockText.slice(lastIndex));
      }
    }
  }

  // Flush any remaining unclosed think block at the very end
  flushThinkContent();

  // Handle unclosed group at end
  if (currentGroup) {
    currentGroup.isStreaming = !!isStreaming;
    closeCurrentGroup();
  }

  // Remove trailing text blocks that contain only suggested-prompts content.
  // These would otherwise become the last item in the result array, preventing
  // the real last content_group from getting isLast=true in the renderer.
  while (result.length > 0) {
    const last = result[result.length - 1];
    const lastText = (last as ContentBlock).text;
    if (last.type !== 'text' || !lastText) break;
    const { cleanedContent } = parseSuggestedPrompts(lastText);
    if (cleanedContent.trim().length > 0) break;
    result.pop();
  }

  return result;
}

/**
 * Format parsed content blocks into markdown
 */
export function formatParsedContent(blocks: ParsedContent[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'augment_code_snippet':
          // Format as a special code block with metadata
          return `\`\`\`${block.metadata?.language || ''}:augment-snippet:${block.metadata?.path || ''}:${block.metadata?.mode || 'EXCERPT'}\n${
            block.content
          }\n\`\`\``;

        case 'code':
          return `\`\`\`${block.metadata?.language || ''}\n${block.content}\n\`\`\``;

        case 'file':
          if (block.metadata?.fileName) {
            return `**File: ${block.metadata.fileName}**\n\`\`\`\n${block.content}\n\`\`\``;
          }
          return `\`\`\`\n${block.content}\n\`\`\``;

        case 'command':
          return `**Command:**\n\`\`\`bash\n$ ${block.metadata?.command || block.content}\n\`\`\``;

        case 'output':
          return `\`\`\`\n${block.content}\n\`\`\``;

        case 'error':
          return `> ⚠️ **Error:**\n> ${block.content.split('\n').join('\n> ')}`;

        case 'text':
        default:
          return block.content;
      }
    })
    .join('\n\n');
}

/**
 * Clean and format agent message for display
 */
export function cleanAgentMessage(content: string): string {
  if (!content) return '';

  // Remove ANSI escape codes
  let cleaned = content.replace(/\u001b\[[0-9;]*m/g, '');

  // Remove tool call blocks by splitting on robot emoji
  // The robot emoji (🤖) marks the start of actual assistant content
  const robotEmojiIndex = cleaned.indexOf('🤖');
  if (robotEmojiIndex !== -1) {
    const beforeRobot = cleaned.substring(0, robotEmojiIndex);
    const afterRobot = cleaned.substring(robotEmojiIndex).trim();

    // If there are tool calls before the robot emoji, remove that entire section
    // i18n-ignore (matches agent transcript markers emitted in English)
    if (beforeRobot.includes('Tool call:') || beforeRobot.includes('Tool result:')) {
      // Remove the robot emoji itself and keep the content after it
      cleaned = afterRobot.replace(/^🤖\s*/, '');
    }
  }

  // Remove logs section and everything after it
  // The "logs:" marker indicates the start of debug/system logs that shouldn't be in the message
  const logsIndex = cleaned.indexOf('\nlogs:');
  if (logsIndex !== -1) {
    cleaned = cleaned.substring(0, logsIndex);
  }

  // Normalize whitespace - primary cleanup
  // The AuggieTextParser should have already filtered out tool artifacts
  cleaned = cleaned
    // Remove trailing whitespace from each line
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    // Remove excessive blank lines (more than 2 consecutive)
    .replace(/\n{3,}/g, '\n\n')
    // Trim overall
    .trim();

  // Parse and format the content
  const parsed = parseAgentMessage(cleaned);

  // If we successfully parsed into multiple blocks, format them
  if (parsed.length > 1) {
    return formatParsedContent(parsed);
  }

  // Otherwise return the cleaned content
  return cleaned.trim();
}

/**
 * Extract tool calls from message content
 *
 * Uses Auggie CLI's standard patterns:
 * - Tool call: \x1b[90m🔧 Tool call: {name}\x1b[0m (grey ANSI)
 * - Tool result: 📋 {name} ✅/❌
 * - Parameters: Indented with 3 spaces after tool call
 */
export function extractToolCalls(content: string): Array<{
  id: string;
  name: string;
  input?: any;
  output?: string;
  error?: string;
  phase: 'start' | 'result';
}> {
  logger.debug('[extractToolCalls] Starting extraction from content length:', content.length);
  const toolCalls: Array<any> = [];
  const lines = content.split('\n');
  logger.debug('[extractToolCalls] Split into', lines.length, 'lines');

  // Auggie CLI standard patterns (from auggie-cli-chat-ui-guide.md)
  const patterns = {
    // Tool call with ANSI grey color: \x1b[90m🔧 Tool call: name\x1b[0m
    toolCallStart: /\x1b\[90m🔧\s+Tool call:\s+(.+?)\x1b\[0m/,
    // Tool call without ANSI (fallback): 🔧 Tool call: name
    toolCallStartNoAnsi: /🔧\s+Tool call:\s+(.+?)$/,
    // Tool result compact format: 📋 name ✅/❌
    toolResultCompact: /📋\s+(.+?)\s+(✅|❌)/,
    // Tool result with ANSI: \x1b[90m📋 name\x1b[0m
    toolResultStart: /\x1b\[90m📋\s+(.+?)\x1b\[0m/,
    // Tool result without ANSI (fallback): 📋 name
    toolResultStartNoAnsi: /📋\s+(.+?)$/,
    // Tool parameters: 3 spaces indentation
    toolParameter: /^ {3}(.+)$/,
    // ANSI color codes (for stripping)
    ansiColor: /\x1b\[[0-9;]*m/g,
  };

  let currentTool: any = null;
  let outputLines: string[] = [];
  let inputLines: string[] = [];
  let inCodeBlock = false;
  let codeBlockType = '';
  let collectingInput = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for Auggie CLI tool call start (with ANSI codes)
    let toolCallStartMatch = line.match(patterns.toolCallStart);
    // Fallback to non-ANSI version if needed
    if (!toolCallStartMatch) {
      toolCallStartMatch = trimmed.match(patterns.toolCallStartNoAnsi);
    }

    if (toolCallStartMatch) {
      logger.debug('[extractToolCalls] Found tool call start:', toolCallStartMatch[1]);
      // Save previous tool if exists
      if (currentTool) {
        if (outputLines.length > 0) {
          currentTool.output = outputLines.join('\n');
        }
        toolCalls.push(currentTool);
      }

      const toolName = toolCallStartMatch[1].trim();
      currentTool = {
        id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        name: toolName,
        phase: 'start' as const,
        input: {},
      };
      outputLines = [];
      inputLines = [];
      collectingInput = true;
      continue;
    }

    // Check for Auggie CLI tool result (compact format: 📋 name ✅/❌)
    let toolResultMatch = trimmed.match(patterns.toolResultCompact);

    // Fallback to detailed format with ANSI codes
    if (!toolResultMatch) {
      toolResultMatch = line.match(patterns.toolResultStart);
    }

    // Fallback to non-ANSI version
    if (!toolResultMatch) {
      toolResultMatch = trimmed.match(patterns.toolResultStartNoAnsi);
    }

    if (toolResultMatch) {
      const toolName = toolResultMatch[1].trim();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const success = toolResultMatch[2] === '✅' || !toolResultMatch[2]; // Default to success if no status

      if (currentTool && currentTool.name === toolName) {
        // This is the result for the current tool call
        // Parse input from collected lines if we haven't already
        if (inputLines.length > 0 && Object.keys(currentTool.input || {}).length === 0) {
          currentTool.input = parseToolInput(inputLines);
        }
        // Push the "start" phase
        toolCalls.push({ ...currentTool });

        // Now create the "result" phase with same input
        currentTool = {
          id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          name: toolName,
          phase: 'result' as const,
          input: currentTool.input,
        };
      } else {
        // Save previous tool if exists
        if (currentTool) {
          if (inputLines.length > 0) {
            currentTool.input = parseToolInput(inputLines);
          }
          toolCalls.push(currentTool);
        }

        // Start new result-only tool call
        currentTool = {
          id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          name: toolName,
          phase: 'result' as const,
          input: {},
        };
      }

      outputLines = [];
      inputLines = [];
      collectingInput = false;
      continue;
    }

    // Collect input parameters (3 spaces indentation per Auggie CLI standard)
    const paramMatch = line.match(patterns.toolParameter);
    if (collectingInput && currentTool && paramMatch) {
      inputLines.push(paramMatch[1]);
      continue;
    } else if (collectingInput && trimmed && !trimmed.startsWith('...')) {
      // Non-indented line means we're done collecting input
      collectingInput = false;
    }

    // Check for code block markers
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        if (currentTool && outputLines.length > 0) {
          currentTool.output = outputLines.join('\n');
          toolCalls.push(currentTool);
          currentTool = null;
          outputLines = [];
        }
        inCodeBlock = false;
        codeBlockType = '';
      } else {
        // Start of code block
        inCodeBlock = true;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        codeBlockType = line.slice(3).trim();
      }
      continue;
    }

    // If we're in a code block, collect the content
    if (inCodeBlock) {
      outputLines.push(line);
      continue;
    }

    // Note: File viewing, directory listing, and file edit patterns are now
    // handled by the AuggieTextParser which uses proper tool call markers.
    // These hacky string matching patterns have been removed in favor of
    // the standard Auggie CLI patterns (🔧 Tool call:, 📋 Tool result:, etc.)

    // Collect output lines if we have a current tool and not collecting input
    if (currentTool && !collectingInput && trimmed && !trimmed.startsWith('...')) {
      outputLines.push(line);
    }
  }

  // Save any remaining tool
  if (currentTool) {
    if (inputLines.length > 0 && currentTool.phase === 'start') {
      currentTool.input = parseToolInput(inputLines);
    }
    if (outputLines.length > 0) {
      currentTool.output = outputLines.join('\n');
    }
    toolCalls.push(currentTool);
  }

  logger.debug('[extractToolCalls] Extracted', toolCalls.length, 'tool calls:', toolCalls);
  return toolCalls;
}

/**
 * Parse tool input parameters from indented lines
 */
function parseToolInput(lines: string[]): any {
  const input: any = {};
  let currentKey: string | null = null;
  let currentValue: string[] = [];
  let inMultilineString = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line starts a new parameter (has a colon near the beginning)
    // But not if we're inside a multi-line string value
    const colonIndex = line.indexOf(':');
    const potentialKey = colonIndex > 0 ? line.substring(0, colonIndex).trim() : '';

    // A line is a new parameter if:
    // 1. It has a colon within the first 30 chars
    // 2. The part before the colon looks like a parameter name (alphanumeric, underscore, dash)
    // 3. We're not currently inside a multi-line string
    const isNewParam =
      colonIndex > 0 &&
      colonIndex < 30 &&
      /^[a-zA-Z_][\w-]*$/.test(potentialKey) &&
      !inMultilineString;

    if (isNewParam) {
      // Save previous parameter if exists
      if (currentKey) {
        let value = currentValue.join('\n').trim();
        // Remove surrounding quotes if present
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
          inMultilineString = false;
        }
        input[currentKey] = value;
      }

      // Start new parameter
      currentKey = potentialKey;
      const valueStart = line.substring(colonIndex + 1).trim();
      currentValue = [valueStart];

      // Check if this starts a multi-line string (starts with quote but doesn't end with one)
      if (
        (valueStart.startsWith('"') && !valueStart.endsWith('"')) ||
        (valueStart.startsWith("'") && !valueStart.endsWith("'"))
      ) {
        inMultilineString = true;
      }
    } else if (currentKey) {
      // Continue current parameter value (multi-line)
      currentValue.push(line);

      // Check if this line ends the multi-line string
      if (inMultilineString && (line.trim().endsWith('"') || line.trim().endsWith("'"))) {
        inMultilineString = false;
      }
    }
  }

  // Save last parameter
  if (currentKey) {
    let value = currentValue.join('\n').trim();
    // Remove surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    input[currentKey] = value;
  }

  return input;
}

/**
 * Matches the opening line of a suggested prompts block. The opener must be the
 * last thing on its line — trailing content means it is prose, not a block.
 * Format:
 * <!-- suggested-prompts
 * Label text|Full prompt text to populate in input
 * Another label|Another full prompt
 * -->
 */
const SUGGESTED_PROMPTS_OPENER_REGEX = /<!--[ \t]*suggested-prompts[ \t]*$/;

/**
 * A block only closes on a `-->` that stands alone on its own line. An embedded
 * `-->` (Mermaid edge, prose arrow) must never terminate a block.
 */
const SUGGESTED_PROMPTS_CLOSER_REGEX = /^[ \t]*-->[ \t]*$/;

/** Opening/closing markdown fence (backtick or tilde), optionally indented. */
const FENCE_LINE_REGEX = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** At most this many prompts are surfaced from a block. */
const MAX_SUGGESTED_PROMPTS = 6;

/** Prompts longer than this are treated as captured body text and dropped. */
const MAX_SUGGESTED_PROMPT_LENGTH = 200;

/**
 * Shapes that indicate the captured line is response body text rather than a
 * deliberate prompt: markdown headings, fence markers, table rows, and Mermaid
 * edges (`A --> B`).
 */
const BODY_TEXT_LINE_PATTERNS = [/^#{1,6}(?:\s|$)/, /^(?:`{3,}|~{3,})/, /^\|/, /\S[ \t]*--+>/];

/**
 * Regex to match the delay prefix in a prompt line.
 * Format: delay:N| where N is an integer (case-insensitive)
 */
const DELAY_PREFIX_REGEX = /^delay:(\d+)\|(.*)$/i;

interface SuggestedPromptsBlock {
  /** Offset of the opener within the original content. */
  start: number;
  /** Offset just past the closing `-->` line. */
  end: number;
  /** Raw lines between the opener and the closer. */
  body: string[];
}

/**
 * Locate every well-formed suggested-prompts block in the content, in order.
 *
 * A block is well-formed only when its opener sits outside any fenced code
 * region and is followed by a `-->` standing alone on its own line.
 */
function findSuggestedPromptsBlocks(content: string): SuggestedPromptsBlock[] {
  const lines = content.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  const blocks: SuggestedPromptsBlock[] = [];
  let fence: { char: string; length: number } | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trimEnd();

    const fenceMatch = line.match(FENCE_LINE_REGEX);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { char: marker[0], length: marker.length };
      } else if (
        marker[0] === fence.char &&
        marker.length >= fence.length &&
        fenceMatch[2].trim() === ''
      ) {
        fence = null;
      }
      i++;
      continue;
    }

    if (fence) {
      i++;
      continue;
    }

    const openerMatch = line.match(SUGGESTED_PROMPTS_OPENER_REGEX);
    if (!openerMatch) {
      i++;
      continue;
    }

    let closerIndex = -1;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const candidate = lines[j].trimEnd();
      if (SUGGESTED_PROMPTS_CLOSER_REGEX.test(candidate)) {
        closerIndex = j;
        break;
      }
      // A second opener means the first one was never closed.
      if (SUGGESTED_PROMPTS_OPENER_REGEX.test(candidate)) break;
    }

    if (closerIndex === -1) {
      // Unclosed opener — resume scanning from wherever we stopped.
      i = j > i ? j : i + 1;
      continue;
    }

    blocks.push({
      start: offsets[i] + (openerMatch.index ?? 0),
      end: offsets[closerIndex] + lines[closerIndex].length,
      body: lines.slice(i + 1, closerIndex),
    });
    i = closerIndex + 1;
  }

  return blocks;
}

/** True when a captured line looks like response body text rather than a prompt. */
function looksLikeBodyText(line: string): boolean {
  return BODY_TEXT_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Parse suggested prompts from message content.
 * Returns an object with the prompts array and the content with the suggestions block removed.
 *
 * Format expected:
 * <!-- suggested-prompts
 * A one-sentence prompt to send immediately
 * Another prompt sentence
 * -->
 *
 * Also supports "Label|Full prompt" syntax where the label is stripped:
 * <!-- suggested-prompts
 * Short label|Let me examine a specific component - which part would you like me to focus on?
 * -->
 *
 * Also strips "delay:N|prompt text" syntax, returning just the text:
 * <!-- suggested-prompts
 * Run tests now
 * delay:60|Check deployment status
 * Label|delay:30|Check build results
 * -->
 *
 * Only well-formed blocks count: the opener must sit outside any code fence and
 * the closing `-->` must stand alone on its own line. The last such block wins,
 * and it is discarded entirely if any captured line looks like response body
 * text — so a Mermaid diagram or table can never surface as prompt chips.
 */
export function parseSuggestedPrompts(content: string): {
  prompts: SuggestedPrompt[];
  cleanedContent: string;
} {
  if (!content) {
    return { prompts: [], cleanedContent: content };
  }

  const blocks = findSuggestedPromptsBlocks(content);
  if (blocks.length === 0) {
    return { prompts: [], cleanedContent: content };
  }

  // Remove every well-formed block from the content (never body text).
  let cleanedContent = '';
  let cursor = 0;
  for (const block of blocks) {
    cleanedContent += content.slice(cursor, block.start);
    cursor = block.end;
  }
  cleanedContent = (cleanedContent + content.slice(cursor)).trim();

  // The last well-formed block wins.
  const lines = blocks[blocks.length - 1].body
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.some(looksLikeBodyText)) {
    return { prompts: [], cleanedContent };
  }

  const prompts: SuggestedPrompt[] = lines
    .map((line): SuggestedPrompt | null => {
      // Strip delay:N| prefix on full line (case-insensitive), returning just the text
      // This handles "delay:60|Check deployment" format
      const fullDelayMatch = line.match(DELAY_PREFIX_REGEX);
      if (fullDelayMatch) {
        const text = fullDelayMatch[2].trim();
        return text.length > 0 ? text : null;
      }

      // Support "Label|Full prompt" syntax - extract just the prompt part after the first pipe
      const pipeIndex = line.indexOf('|');
      let promptPart = line;
      if (pipeIndex !== -1) {
        promptPart = line.slice(pipeIndex + 1).trim();

        // Strip delay:N| prefix after label (handles "Label|delay:30|text" format)
        const delayMatch = promptPart.match(DELAY_PREFIX_REGEX);
        if (delayMatch) {
          const text = delayMatch[2].trim();
          return text.length > 0 ? text : null;
        }
      }

      // Return as plain string
      return promptPart.length > 0 ? promptPart : null;
    })
    .filter((prompt): prompt is SuggestedPrompt => prompt !== null)
    // Over-long entries are body text that slipped through, not prompts.
    .filter((prompt) => prompt.length <= MAX_SUGGESTED_PROMPT_LENGTH)
    .slice(0, MAX_SUGGESTED_PROMPTS);

  return { prompts, cleanedContent };
}

/**
 * Check if content contains a well-formed suggested prompts block
 */
export function hasSuggestedPrompts(content: string): boolean {
  if (!content) return false;
  return findSuggestedPromptsBlocks(content).length > 0;
}
