/**
 * Agent Anchor Preservation
 *
 * Preserves agent anchors when notes are updated by other agents.
 * Agent anchors: <!--agent:agent-id--> at end of task items
 *
 * When Agent A is assigned to a task, the anchor is stored in the markdown.
 * When Agent B updates the note, it may not include Agent A's anchor.
 * This module extracts existing anchors and re-inserts them by matching task text.
 */

import { Logger } from '../../shared/logger';

const logger = new Logger('AgentAnchorPreservation');

/** Minimum similarity score (0-1) for matching tasks */
const SIMILARITY_THRESHOLD = 0.5;

/** Pattern to match agent anchors: <!--agent:agent-id--> */
const AGENT_ANCHOR_PATTERN = /<!--agent:([^>]+)-->/;

/** Pattern to match trailing agent anchor with optional whitespace */
const TRAILING_ANCHOR_PATTERN = /\s*<!--agent:[^>]+-->$/;

/**
 * Represents an agent anchor extracted from markdown
 */
interface AgentAnchor {
  agentId: string;
  taskText: string;
}

/**
 * Match result for task similarity matching
 */
interface TaskMatch {
  lineIndex: number;
  similarity: number;
}

/**
 * Result of anchor preservation operation
 */
export interface PreservationResult {
  content: string;
  preserved: string[];
  lost: string[];
}

/**
 * Check if a line is a task item and extract its text
 * Returns null if not a task item
 */
function parseTaskLine(line: string): { taskText: string; hasAnchor: boolean } | null {
  // Match: optional whitespace, dash, whitespace, checkbox, whitespace, task text
  const match = line.match(/^\s*-\s*\[[ x\/]\]\s*(.+?)(?:\s*<!--agent:[^>]+-->)?$/);
  if (!match) return null;

  return {
    taskText: match[1].trim(),
    hasAnchor: AGENT_ANCHOR_PATTERN.test(line),
  };
}

/**
 * Extract all agent anchors from markdown content
 */
export function extractAgentAnchors(markdown: string): AgentAnchor[] {
  if (!markdown) return [];

  const anchors: AgentAnchor[] = [];
  const lines = markdown.split('\n');

  for (const line of lines) {
    const parsed = parseTaskLine(line);
    if (!parsed) continue;

    const anchorMatch = line.match(AGENT_ANCHOR_PATTERN);
    if (anchorMatch) {
      anchors.push({
        agentId: anchorMatch[1],
        taskText: parsed.taskText,
      });
    }
  }

  return anchors;
}

/**
 * Normalize task text for comparison
 * - Trims whitespace
 * - Collapses multiple spaces
 * - Converts to lowercase
 */
function normalizeTaskText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Calculate Jaccard similarity between two task texts
 * Returns a value between 0 (no similarity) and 1 (identical)
 */
function calculateSimilarity(a: string, b: string): number {
  const normA = normalizeTaskText(a);
  const normB = normalizeTaskText(b);

  // Exact match
  if (normA === normB) return 1;

  // Empty strings
  if (normA.length === 0 || normB.length === 0) return 0;

  // Substring match (common when task is edited slightly)
  if (normA.includes(normB) || normB.includes(normA)) {
    const minLen = Math.min(normA.length, normB.length);
    const maxLen = Math.max(normA.length, normB.length);
    return minLen / maxLen;
  }

  // Word-based Jaccard similarity
  const wordsAArr = normA.split(' ').filter((w) => w.length > 0);
  const wordsBSet = new Set(normB.split(' ').filter((w) => w.length > 0));
  const wordsASet = new Set(wordsAArr);

  let intersectionCount = 0;
  for (let i = 0; i < wordsAArr.length; i++) {
    if (wordsBSet.has(wordsAArr[i])) intersectionCount++;
  }

  // Union size = |A| + |B| - |intersection|
  const unionSize = wordsASet.size + wordsBSet.size - intersectionCount;

  return unionSize === 0 ? 0 : intersectionCount / unionSize;
}

/**
 * Find the best matching task line for a given task text
 * Uses similarity scoring to handle minor text changes
 */
function findMatchingTask(
  taskText: string,
  lines: string[],
  usedMatches: Set<number>,
): TaskMatch | null {
  let bestMatch: TaskMatch | null = null;

  for (let i = 0; i < lines.length; i++) {
    // Skip already matched lines
    if (usedMatches.has(i)) continue;

    const parsed = parseTaskLine(lines[i]);
    if (!parsed) continue;

    const similarity = calculateSimilarity(taskText, parsed.taskText);

    if (similarity >= SIMILARITY_THRESHOLD) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { lineIndex: i, similarity };
      }
    }
  }

  return bestMatch;
}

/**
 * Preserve agent anchors when updating note content
 *
 * When an agent updates a note, it may not include anchors for tasks
 * assigned to other agents. This function:
 * 1. Extracts existing anchors from the old content
 * 2. Checks which anchors are missing from the new content
 * 3. Matches missing anchors to tasks by text similarity
 * 4. Re-inserts anchors at the end of matching task lines
 *
 * @param existingContent - The current note content (with anchors)
 * @param newContent - The new content being saved (may be missing anchors)
 * @returns Object with updated content and lists of preserved/lost agent IDs
 */
export function preserveAgentAnchors(
  existingContent: string,
  newContent: string,
): PreservationResult {
  // Handle null/undefined inputs
  if (!existingContent || !newContent) {
    return { content: newContent || '', preserved: [], lost: [] };
  }

  // Extract anchors from existing content
  const existingAnchors = extractAgentAnchors(existingContent);
  if (existingAnchors.length === 0) {
    return { content: newContent, preserved: [], lost: [] };
  }

  // Check which anchors are already in the new content
  const newAnchors = extractAgentAnchors(newContent);
  const newAgentIds = new Set(newAnchors.map((a) => a.agentId));

  // Find anchors that need to be preserved (not already in new content)
  const anchorsToPreserve = existingAnchors.filter((a) => !newAgentIds.has(a.agentId));

  if (anchorsToPreserve.length === 0) {
    return { content: newContent, preserved: [], lost: [] };
  }

  logger.debug('Preserving agent anchors', {
    count: anchorsToPreserve.length,
    agentIds: anchorsToPreserve.map((a) => a.agentId),
  });

  const lines = newContent.split('\n');
  const usedMatches = new Set<number>();
  const preserved: string[] = [];
  const lost: string[] = [];

  // Try to match each anchor to a task in the new content
  for (const anchor of anchorsToPreserve) {
    const match = findMatchingTask(anchor.taskText, lines, usedMatches);

    if (match) {
      usedMatches.add(match.lineIndex);

      // Remove any existing anchor (shouldn't happen but be defensive)
      const cleanLine = lines[match.lineIndex].replace(TRAILING_ANCHOR_PATTERN, '');
      lines[match.lineIndex] = `${cleanLine} <!--agent:${anchor.agentId}-->`;

      preserved.push(anchor.agentId);

      logger.debug('Preserved anchor', {
        agentId: anchor.agentId,
        lineIndex: match.lineIndex,
        similarity: match.similarity.toFixed(2),
      });
    } else {
      lost.push(anchor.agentId);
      logger.warn('Lost anchor - no matching task found', {
        agentId: anchor.agentId,
        originalTaskText: anchor.taskText,
      });
    }
  }

  return {
    content: lines.join('\n'),
    preserved,
    lost,
  };
}
