/**
 * Markdown-based anchor recovery
 *
 * This module provides functions to recover missing or partial comment anchors
 * in markdown documents. It operates on plain markdown strings with HTML comment
 * anchors: <!--anchor:comment-id:start--> and <!--anchor:comment-id:end-->
 *
 * Key advantages over ProseMirror-based recovery:
 * - Consistent coordinate system (all positions in same string)
 * - Simple duplicate handling (remove all, then insert exactly one pair)
 * - Easy to test (pure functions, no editor setup needed)
 * - No position mixing bugs
 *
 * Recovery Strategy (Cascade of Heuristics):
 * 1. Find "anchor neighbor" word - the word adjacent to the missing anchor (90% confidence)
 * 2. Find longest sequence of original words still present (70% confidence)
 * 3. Roll forward/backward character-by-character until unrecognized character (50% confidence)
 * 4. FAIL if nothing found within ~75 character threshold
 *
 * Anchor Normalization:
 * - Prevents anchors from breaking markdown syntax by moving them after control symbols
 * - Example: `<!--anchor:id:start-->## Title` → `## <!--anchor:id:start-->Title`
 */

import type { NoteVersion } from '../../../shared/types';
import { Logger } from '../../../shared/logger';

const logger = new Logger('MarkdownAnchorRecovery');

// ============================================================================
// Debug Utilities
// ============================================================================

/**
 * Feature flag: Enable debug file writing
 * Set to false to disable debug output
 */
const ENABLE_DEBUG_FILES = false;

/**
 * Get debug directory path
 * Only works in Node.js environment (backend)
 */
function getDebugDir(): string {
  // Dynamic require to avoid loading fs in browser
   
  const path = require('path') as typeof import('path');
  const os = require('os') as typeof import('os');
  const fs = require('fs') as typeof import('fs');
   

  const debugDir = path.join(os.homedir(), 'intent', 'recovery-debug');
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  return debugDir;
}

/**
 * Write recovery debug file
 * Only works in Node.js environment (backend)
 */
function writeDebugFile(
  noteId: string,
  commentId: string,
  data: {
    originalMarkdown: string;
    recoveredMarkdown: string;
    state: AnchorState;
    method?: string;
    confidence?: number;
    success: boolean;
    reason?: string;
    anchoredText?: string;
    contextBefore?: string;
    contextAfter?: string;
  },
): void {
  if (!ENABLE_DEBUG_FILES) return;

  // Only write debug files in Node.js environment (backend)
  if (typeof window !== 'undefined') return;

  try {
    // Dynamic require to avoid loading fs in browser
     
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
     

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}_${noteId}_${commentId}.json`;
    const filepath = path.join(getDebugDir(), filename);

    const debugData = {
      timestamp: new Date().toISOString(),
      noteId,
      commentId,
      ...data,
      diff: {
        originalLength: data.originalMarkdown.length,
        recoveredLength: data.recoveredMarkdown.length,
        changed: data.originalMarkdown !== data.recoveredMarkdown,
      },
    };

    fs.writeFileSync(filepath, JSON.stringify(debugData, null, 2), 'utf-8');
  } catch (error) {
    // Silently fail - debug files are best effort
    logger.debug('Failed to write debug file', { error });
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Positions of anchors in markdown string
 */
export interface AnchorPositions {
  /** Position of start anchor, or undefined if not found */
  start?: number;
  /** Position of end anchor, or undefined if not found */
  end?: number;
}

/**
 * State of a comment's anchors
 */
export type AnchorState =
  | 'HEALTHY'
  | 'PARTIAL_START_ONLY'
  | 'PARTIAL_END_ONLY'
  | 'DEGENERATE'
  | 'ORPHANED';

/**
 * Information about a problematic anchor
 */
export interface ProblematicAnchorInfo {
  /** Comment ID */
  commentId: string;
  /** State of the anchors */
  state: AnchorState;
}

/**
 * Result of a recovery attempt
 */
export interface RecoveryResult {
  /** Whether recovery succeeded */
  success: boolean;
  /** Updated markdown with recovered anchors (only if success=true) */
  markdown?: string;
  /** Method used for recovery */
  method?: 'anchor-neighbor' | 'longest-sequence' | 'character-roll';
  /** Confidence level (0.5 = low, 0.7 = medium, 0.9 = high) */
  confidence?: number;
  /** Reason for failure (only if success=false) */
  reason?: string;
}

/**
 * Extracted text and context from a version
 */
export interface AnchoredTextInfo {
  /** The text that was between the anchors */
  text: string;
  /** Text before the start anchor (up to 50 chars) */
  contextBefore: string;
  /** Text after the end anchor (up to 50 chars) */
  contextAfter: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum distance to search for matching text (in characters) */
const DISTANCE_THRESHOLD = 75;

/** Amount of context to extract before/after anchors (in characters) */
const CONTEXT_LENGTH = 50;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Validate that anchor positions form a valid pair
 *
 * A valid anchor pair must have:
 * - Both start and end positions defined
 * - End position after start position (with room for anchor markers)
 *
 * @param positions - The anchor positions to validate
 * @returns true if the anchor pair is valid, false otherwise
 *
 * @example
 * ```typescript
 * validateAnchorPair({ start: 10, end: 50 }); // true
 * validateAnchorPair({ start: 50, end: 10 }); // false (reversed)
 * validateAnchorPair({ start: 10, end: undefined }); // false (incomplete)
 * ```
 */
export function validateAnchorPair(positions: AnchorPositions): boolean {
  if (positions.start === undefined || positions.end === undefined) {
    return false;
  }

  // End must come after start (with room for the start anchor marker itself)
  return positions.end > positions.start;
}

/**
 * Find anchor positions in markdown string
 *
 * @param markdown - The markdown string to search
 * @param commentId - The comment ID to find anchors for
 * @returns Positions of start and end anchors, or undefined if not found
 *
 * @example
 * ```typescript
 * const markdown = "Hello <!--anchor:test:start-->world<!--anchor:test:end--> today";
 * const positions = findAnchorsInMarkdown(markdown, "test");
 * // { start: 6, end: 35 }
 * ```
 */
export function findAnchorsInMarkdown(markdown: string, commentId: string): AnchorPositions {
  const startPattern = `<!--anchor:${commentId}:start-->`;
  const endPattern = `<!--anchor:${commentId}:end-->`;

  const startPos = markdown.indexOf(startPattern);
  const endPos = markdown.indexOf(endPattern);

  return {
    start: startPos !== -1 ? startPos : undefined,
    end: endPos !== -1 ? endPos : undefined,
  };
}

/**
 * Remove all anchors for a comment from markdown
 *
 * This is used to clean up duplicate anchors before inserting new ones.
 * Uses global regex replace to remove ALL occurrences.
 *
 * @param markdown - The markdown string to clean
 * @param commentId - The comment ID whose anchors should be removed
 * @returns Markdown with all anchors removed
 *
 * @example
 * ```typescript
 * const markdown = "<!--anchor:test:start-->Hello<!--anchor:test:end--> world";
 * const clean = removeAnchors(markdown, "test");
 * // "Hello world"
 * ```
 */
export function removeAnchors(markdown: string, commentId: string): string {
  const startPattern = `<!--anchor:${commentId}:start-->`;
  const endPattern = `<!--anchor:${commentId}:end-->`;

  return markdown
    .replace(new RegExp(escapeRegex(startPattern), 'g'), '')
    .replace(new RegExp(escapeRegex(endPattern), 'g'), '');
}

/**
 * Extract the text that was anchored in a version, plus surrounding context
 *
 * @param markdown - The markdown string containing anchors
 * @param commentId - The comment ID to extract text for
 * @returns Anchored text and context, or null if anchors not found
 *
 * @example
 * ```typescript
 * const markdown = "Hello <!--anchor:test:start-->world<!--anchor:test:end--> today";
 * const info = extractAnchoredText(markdown, "test");
 * // { text: "world", contextBefore: "Hello ", contextAfter: " today" }
 * ```
 */
export function extractAnchoredText(markdown: string, commentId: string): AnchoredTextInfo | null {
  const startPattern = `<!--anchor:${commentId}:start-->`;
  const endPattern = `<!--anchor:${commentId}:end-->`;

  const startPos = markdown.indexOf(startPattern);
  const endPos = markdown.indexOf(endPattern);

  if (startPos === -1 || endPos === -1) {
    return null;
  }

  // Validate that anchors are in correct order
  if (!validateAnchorPair({ start: startPos, end: endPos })) {
    return null;
  }

  const textStart = startPos + startPattern.length;
  const text = markdown.substring(textStart, endPos);

  const contextBefore = markdown.substring(Math.max(0, startPos - CONTEXT_LENGTH), startPos);
  const contextAfter = markdown.substring(
    endPos + endPattern.length,
    endPos + endPattern.length + CONTEXT_LENGTH,
  );

  return { text, contextBefore, contextAfter };
}

/**
 * Recover missing end anchor (have start, need end)
 *
 * Strategy: We know where the start anchor is in the current markdown.
 * We need to find where to place the end anchor based on the original text.
 *
 * @param markdown - Current markdown with start anchor but missing end anchor
 * @param commentId - The comment ID to recover
 * @param originalText - The text that was originally anchored
 * @param contextAfter - Text that was after the end anchor in the original
 * @returns Recovery result with updated markdown if successful
 */
export function recoverMissingEndAnchor(
  markdown: string,
  commentId: string,
  originalText: string,
  contextAfter: string,
): RecoveryResult {
  const startPattern = `<!--anchor:${commentId}:start-->`;
  const endPattern = `<!--anchor:${commentId}:end-->`;

  // Find where the start anchor currently is
  const startAnchorPos = markdown.indexOf(startPattern);
  if (startAnchorPos === -1) {
    return { success: false, reason: 'start-anchor-not-found' };
  }

  // Position right after the start anchor is where the text begins
  const textStartPos = startAnchorPos + startPattern.length;

  // Heuristic 1: Find anchor neighbor word (word that was after the end anchor in original)
  const neighborWord = contextAfter.trim().split(/\s+/)[0];
  if (neighborWord) {
    // Search for neighbor word after the start anchor
    const searchStart = textStartPos;
    const searchEnd = Math.min(markdown.length, textStartPos + DISTANCE_THRESHOLD);
    const searchText = markdown.substring(searchStart, searchEnd);

    const neighborIdx = searchText.indexOf(neighborWord);
    if (neighborIdx !== -1) {
      // Found the neighbor word! Now find where it actually starts (including any leading whitespace)
      // We want to preserve whitespace before the neighbor word
      let endPos = textStartPos + neighborIdx;

      // Walk backwards from the neighbor word to find the last non-whitespace character
      // This preserves any whitespace (including newlines) that the user may have added
      while (endPos > textStartPos && /\s/.test(markdown[endPos - 1])) {
        endPos--;
      }

      // Remove any existing anchors first, then insert new ones
      const cleanMarkdown = removeAnchors(markdown, commentId);

      // Recalculate positions in clean markdown
      const textBeforeNeighbor = markdown.substring(textStartPos, endPos);
      const textBeforeNeighborStart = cleanMarkdown.indexOf(textBeforeNeighbor);

      if (textBeforeNeighborStart !== -1) {
        const cleanStartPos = textBeforeNeighborStart;
        const cleanEndPos = textBeforeNeighborStart + textBeforeNeighbor.length;

        const result =
          cleanMarkdown.substring(0, cleanStartPos) +
          startPattern +
          cleanMarkdown.substring(cleanStartPos, cleanEndPos) +
          endPattern +
          cleanMarkdown.substring(cleanEndPos);

        // Validate the recovered anchors are in correct order
        const positions = findAnchorsInMarkdown(result, commentId);
        if (!validateAnchorPair(positions)) {
          return { success: false, reason: 'invalid-anchor-order' };
        }

        return {
          success: true,
          markdown: result,
          method: 'anchor-neighbor',
          confidence: 0.9,
        };
      }
    }
  }

  // Heuristic 2: Find longest sequence of original words
  const cleanMarkdown = removeAnchors(markdown, commentId);

  // Strip punctuation from words for matching
  const stripPunctuation = (word: string) => word.replace(/[.,!?;:'"()]/g, '');
  const originalWords = originalText
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => stripPunctuation(w))
    .filter((w) => w.length > 0);

  let longestMatch = { length: 0, startPos: -1, endPos: -1 };

  for (let i = 0; i < originalWords.length; i++) {
    const firstWord = originalWords[i];
    const firstWordIdx = cleanMarkdown.indexOf(firstWord);

    if (firstWordIdx === -1) continue;

    let matchLength = 1;
    let searchPos = firstWordIdx + firstWord.length;

    for (let j = i + 1; j < originalWords.length; j++) {
      const word = originalWords[j];
      const wordIdx = cleanMarkdown
        .substring(searchPos, searchPos + DISTANCE_THRESHOLD)
        .indexOf(word);

      if (wordIdx === -1) break;

      matchLength++;
      searchPos = searchPos + wordIdx + word.length;
    }

    if (matchLength > longestMatch.length) {
      longestMatch = {
        length: matchLength,
        startPos: firstWordIdx,
        endPos: searchPos,
      };
    }
  }

  if (longestMatch.length > 0) {
    const result =
      cleanMarkdown.substring(0, longestMatch.startPos) +
      startPattern +
      cleanMarkdown.substring(longestMatch.startPos, longestMatch.endPos) +
      endPattern +
      cleanMarkdown.substring(longestMatch.endPos);

    // Validate the recovered anchors are in correct order
    const positions = findAnchorsInMarkdown(result, commentId);
    if (!validateAnchorPair(positions)) {
      return { success: false, reason: 'invalid-anchor-order' };
    }

    return {
      success: true,
      markdown: result,
      method: 'longest-sequence',
      confidence: 0.7,
    };
  }

  // Heuristic 3: Character-by-character roll
  const firstChar = originalText[0];
  const firstCharIdx = cleanMarkdown.indexOf(firstChar);

  if (firstCharIdx !== -1) {
    let endPos = firstCharIdx;
    for (let i = 0; i < Math.min(originalText.length, DISTANCE_THRESHOLD); i++) {
      if (cleanMarkdown[firstCharIdx + i] !== originalText[i]) {
        break;
      }
      endPos = firstCharIdx + i + 1;
    }

    if (endPos > firstCharIdx) {
      const result =
        cleanMarkdown.substring(0, firstCharIdx) +
        startPattern +
        cleanMarkdown.substring(firstCharIdx, endPos) +
        endPattern +
        cleanMarkdown.substring(endPos);

      // Validate the recovered anchors are in correct order
      const positions = findAnchorsInMarkdown(result, commentId);
      if (!validateAnchorPair(positions)) {
        return { success: false, reason: 'invalid-anchor-order' };
      }

      return {
        success: true,
        markdown: result,
        method: 'character-roll',
        confidence: 0.5,
      };
    }
  }

  return {
    success: false,
    reason: 'no-matching-text',
  };
}

/**
 * Recover missing start anchor (have end, need start)
 *
 * Strategy: We know where the end anchor is in the current markdown.
 * We need to find where to place the start anchor based on the original text.
 *
 * @param markdown - Current markdown with end anchor but missing start anchor
 * @param commentId - The comment ID to recover
 * @param originalText - The text that was originally anchored
 * @param contextBefore - Text that was before the start anchor in the original
 * @returns Recovery result with updated markdown if successful
 */
export function recoverMissingStartAnchor(
  markdown: string,
  commentId: string,
  originalText: string,
  contextBefore: string,
): RecoveryResult {
  const cleanMarkdown = removeAnchors(markdown, commentId);
  const startPattern = `<!--anchor:${commentId}:start-->`;
  const endPattern = `<!--anchor:${commentId}:end-->`;

  // Heuristic 1: Find anchor neighbor word (word before start anchor)
  const neighborWord = contextBefore.trim().split(/\s+/).pop();
  if (neighborWord) {
    const neighborIdx = cleanMarkdown.lastIndexOf(neighborWord);
    if (neighborIdx !== -1) {
      // Start searching after the neighbor word, but skip any trailing whitespace
      // to preserve whitespace that the user may have added
      let searchStart = neighborIdx + neighborWord.length;

      // Skip whitespace after the neighbor word
      while (searchStart < cleanMarkdown.length && /\s/.test(cleanMarkdown[searchStart])) {
        searchStart++;
      }

      const searchEnd = Math.min(cleanMarkdown.length, searchStart + DISTANCE_THRESHOLD);
      const searchText = cleanMarkdown.substring(searchStart, searchEnd);

      const originalWords = originalText.trim().split(/\s+/);
      const lastWord = originalWords[originalWords.length - 1];

      if (lastWord) {
        const lastWordIdx = searchText.indexOf(lastWord);
        if (lastWordIdx !== -1) {
          // Find where the last word actually starts in the clean markdown
          const lastWordPosInClean = searchStart + lastWordIdx;

          // Find the first word of the original text
          const firstWord = originalWords[0];
          const firstWordIdx = cleanMarkdown
            .substring(searchStart, lastWordPosInClean)
            .lastIndexOf(firstWord);

          if (firstWordIdx !== -1) {
            const startPos = searchStart + firstWordIdx;
            const endPos = lastWordPosInClean + lastWord.length;

            const result =
              cleanMarkdown.substring(0, startPos) +
              startPattern +
              cleanMarkdown.substring(startPos, endPos) +
              endPattern +
              cleanMarkdown.substring(endPos);

            // Validate the recovered anchors are in correct order
            const positions = findAnchorsInMarkdown(result, commentId);
            if (!validateAnchorPair(positions)) {
              return { success: false, reason: 'invalid-anchor-order' };
            }

            return {
              success: true,
              markdown: result,
              method: 'anchor-neighbor',
              confidence: 0.9,
            };
          }
        }
      }
    }
  }

  // Heuristic 2: Find longest sequence (searching backward)
  const originalWords = originalText.split(/\s+/).filter((w) => w.length > 0);
  let longestMatch = { length: 0, startPos: -1, endPos: -1 };

  for (let i = 0; i < originalWords.length; i++) {
    const firstWord = originalWords[i];
    const firstWordIdx = cleanMarkdown.indexOf(firstWord);

    if (firstWordIdx === -1) continue;

    let matchLength = 1;
    let searchPos = firstWordIdx + firstWord.length;

    for (let j = i + 1; j < originalWords.length; j++) {
      const word = originalWords[j];
      const wordIdx = cleanMarkdown
        .substring(searchPos, searchPos + DISTANCE_THRESHOLD)
        .indexOf(word);

      if (wordIdx === -1) break;

      matchLength++;
      searchPos = searchPos + wordIdx + word.length;
    }

    if (matchLength > longestMatch.length) {
      longestMatch = {
        length: matchLength,
        startPos: firstWordIdx,
        endPos: searchPos,
      };
    }
  }

  if (longestMatch.length > 0) {
    const result =
      cleanMarkdown.substring(0, longestMatch.startPos) +
      startPattern +
      cleanMarkdown.substring(longestMatch.startPos, longestMatch.endPos) +
      endPattern +
      cleanMarkdown.substring(longestMatch.endPos);

    // Validate the recovered anchors are in correct order
    const positions = findAnchorsInMarkdown(result, commentId);
    if (!validateAnchorPair(positions)) {
      return { success: false, reason: 'invalid-anchor-order' };
    }

    return {
      success: true,
      markdown: result,
      method: 'longest-sequence',
      confidence: 0.7,
    };
  }

  // Heuristic 3: Character roll (backward)
  const lastChar = originalText[originalText.length - 1];
  const lastCharIdx = cleanMarkdown.lastIndexOf(lastChar);

  if (lastCharIdx !== -1) {
    let startPos = lastCharIdx + 1;
    for (
      let i = originalText.length - 1;
      i >= 0 && lastCharIdx - (originalText.length - 1 - i) >= 0;
      i--
    ) {
      if (cleanMarkdown[lastCharIdx - (originalText.length - 1 - i)] !== originalText[i]) {
        break;
      }
      startPos = lastCharIdx - (originalText.length - 1 - i);
    }

    if (startPos <= lastCharIdx) {
      const result =
        cleanMarkdown.substring(0, startPos) +
        startPattern +
        cleanMarkdown.substring(startPos, lastCharIdx + 1) +
        endPattern +
        cleanMarkdown.substring(lastCharIdx + 1);

      // Validate the recovered anchors are in correct order
      const positions = findAnchorsInMarkdown(result, commentId);
      if (!validateAnchorPair(positions)) {
        return { success: false, reason: 'invalid-anchor-order' };
      }

      return {
        success: true,
        markdown: result,
        method: 'character-roll',
        confidence: 0.5,
      };
    }
  }

  return {
    success: false,
    reason: 'no-matching-text',
  };
}

// ============================================================================
// High-Level Recovery Functions
// ============================================================================

/**
 * Scan markdown for problematic anchors
 *
 * Identifies comments that have anchor issues:
 * - PARTIAL_START_ONLY: Only start anchor present
 * - PARTIAL_END_ONLY: Only end anchor present
 * - DEGENERATE: Both anchors present but no text between them
 *
 * @param markdown - The markdown string to scan
 * @param commentIds - List of comment IDs to check
 * @returns List of problematic anchor information
 *
 * @example
 * ```typescript
 * const markdown = "Hello <!--anchor:c1:start-->world";
 * const problems = scanForProblematicAnchors(markdown, ["c1", "c2"]);
 * // [{ commentId: "c1", state: "PARTIAL_START_ONLY" }]
 * ```
 */
export function scanForProblematicAnchors(
  markdown: string,
  commentIds: string[],
): ProblematicAnchorInfo[] {
  const problematicAnchors: ProblematicAnchorInfo[] = [];

  for (const commentId of commentIds) {
    const positions = findAnchorsInMarkdown(markdown, commentId);

    if (positions.start !== undefined && positions.end === undefined) {
      problematicAnchors.push({ commentId, state: 'PARTIAL_START_ONLY' });
    } else if (positions.start === undefined && positions.end !== undefined) {
      problematicAnchors.push({ commentId, state: 'PARTIAL_END_ONLY' });
    } else if (positions.start !== undefined && positions.end !== undefined) {
      // Check for degenerate anchors (both present but no text between)
      const startPattern = `<!--anchor:${commentId}:start-->`;
      const startAnchorEnd = positions.start + startPattern.length;
      const endAnchorStart = positions.end;

      if (startAnchorEnd <= endAnchorStart) {
        const textBetween = markdown.substring(startAnchorEnd, endAnchorStart);

        if (textBetween.trim().length === 0) {
          problematicAnchors.push({ commentId, state: 'DEGENERATE' });
        }
      }
    }
  }

  return problematicAnchors;
}

/**
 * Remove degenerate anchors from markdown
 *
 * Removes both start and end anchors for comments that have no meaningful text between them.
 *
 * @param markdown - The markdown string to clean
 * @param commentIds - List of comment IDs with degenerate anchors
 * @returns Cleaned markdown with degenerate anchors removed
 *
 * @example
 * ```typescript
 * const markdown = "Hello<!--anchor:c1:start--><!--anchor:c1:end--> world";
 * const cleaned = removeDegenerateAnchors(markdown, ["c1"]);
 * // "Hello world"
 * ```
 */
export function removeDegenerateAnchors(markdown: string, commentIds: string[]): string {
  let result = markdown;

  for (const commentId of commentIds) {
    // Remove both anchors for this comment
    result = removeAnchors(result, commentId);
  }

  return result;
}

/**
 * Find the most recent healthy version for a comment
 *
 * Searches versions from newest to oldest to find the first version
 * where both anchors exist.
 *
 * @param commentId - The comment ID to find healthy version for
 * @param versions - List of note versions (newest first)
 * @returns The healthy version, or null if none found
 */
export function findMostRecentHealthyVersion(
  commentId: string,
  versions: NoteVersion[],
): NoteVersion | null {
  // Search from newest to oldest
  for (const version of versions) {
    const positions = findAnchorsInMarkdown(version.content, commentId);
    if (positions.start !== undefined && positions.end !== undefined) {
      return version;
    }
  }
  return null;
}

/**
 * Recover a single partial anchor
 *
 * Main entry point for recovering a comment with one missing anchor.
 * Finds the most recent healthy version and attempts recovery.
 *
 * @param markdown - Current markdown with partial anchor
 * @param commentId - The comment ID to recover
 * @param versions - List of note versions (newest first)
 * @returns Recovery result with updated markdown if successful
 *
 * @example
 * ```typescript
 * const current = "Hello <!--anchor:c1:start-->world";
 * const versions = [
 *   { content: "Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->" }
 * ];
 * const result = recoverPartialAnchor(current, "c1", versions);
 * // { success: true, markdown: "Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->" }
 * ```
 */
export function recoverPartialAnchor(
  markdown: string,
  commentId: string,
  versions: NoteVersion[],
): RecoveryResult {
  // 1. Detect which anchor is missing
  const positions = findAnchorsInMarkdown(markdown, commentId);

  if (positions.start !== undefined && positions.end !== undefined) {
    return { success: false, reason: 'both-anchors-present' };
  }

  if (positions.start === undefined && positions.end === undefined) {
    return { success: false, reason: 'both-anchors-missing' };
  }

  // 2. Find most recent healthy version
  const healthyVersion = findMostRecentHealthyVersion(commentId, versions);
  if (!healthyVersion) {
    return { success: false, reason: 'no-healthy-version' };
  }

  // 3. Extract original text and context
  const anchoredInfo = extractAnchoredText(healthyVersion.content, commentId);
  if (!anchoredInfo) {
    return { success: false, reason: 'failed-to-extract-text' };
  }

  // 4. Call appropriate recovery function
  if (positions.start !== undefined && positions.end === undefined) {
    // Have start, need end
    return recoverMissingEndAnchor(
      markdown,
      commentId,
      anchoredInfo.text,
      anchoredInfo.contextAfter,
    );
  } else {
    // Have end, need start
    return recoverMissingStartAnchor(
      markdown,
      commentId,
      anchoredInfo.text,
      anchoredInfo.contextBefore,
    );
  }
}

/**
 * Result of recovering all partial anchors
 */
export interface RecoverAllResult {
  /** Updated markdown with all recovered anchors */
  markdown: string;
  /** List of comment IDs that were successfully recovered */
  recovered: string[];
  /** List of comment IDs that failed to recover */
  failed: string[];
}

/**
 * Recover all partial anchors in markdown
 *
 * Orchestrates recovery for multiple comments. Processes each partial
 * anchor and returns the final markdown with all successful recoveries.
 *
 * **Important**: If recovery fails for a comment, its partial anchors are
 * removed from the markdown to avoid leaving orphaned anchor markers.
 *
 * @param markdown - Current markdown with partial anchors
 * @param commentIds - List of comment IDs to check and recover
 * @param versions - List of note versions (newest first)
 * @param noteId - Optional note ID for debug file writing
 * @returns Result with updated markdown and lists of recovered/failed comments
 *
 * @example
 * ```typescript
 * const markdown = "Hello <!--anchor:c1:start-->world <!--anchor:c2:end-->";
 * const result = recoverAllPartialAnchors(markdown, ["c1", "c2"], versions);
 * // {
 * //   markdown: "Hello <!--anchor:c1:start-->world<!--anchor:c1:end--> <!--anchor:c2:start-->foo<!--anchor:c2:end-->",
 * //   recovered: ["c1", "c2"],
 * //   failed: []
 * // }
 * ```
 */
export function recoverAllPartialAnchors(
  markdown: string,
  commentIds: string[],
  versions: NoteVersion[],
  noteId?: string,
): RecoverAllResult {
  const recovered: string[] = [];
  const failed: string[] = [];
  let currentMarkdown = markdown;

  // Find all problematic anchors (partial and degenerate)
  const problematicAnchors = scanForProblematicAnchors(currentMarkdown, commentIds);

  // Attempt to recover or clean up each one
  for (const problem of problematicAnchors) {
    const originalMarkdown = currentMarkdown;

    // Degenerate anchors cannot be recovered - just remove them
    if (problem.state === 'DEGENERATE') {
      failed.push(problem.commentId);
      currentMarkdown = removeAnchors(currentMarkdown, problem.commentId);

      // Write debug file for degenerate anchor
      if (noteId) {
        writeDebugFile(noteId, problem.commentId, {
          originalMarkdown,
          recoveredMarkdown: currentMarkdown,
          state: problem.state,
          success: false,
          reason: 'Degenerate anchor: both anchors present but no text between them',
        });
      }
      continue;
    }

    // Try to recover partial anchors
    const result = recoverPartialAnchor(currentMarkdown, problem.commentId, versions);

    if (result.success && result.markdown) {
      currentMarkdown = result.markdown;
      recovered.push(problem.commentId);

      // Write debug file for successful recovery
      if (noteId) {
        // Extract anchored text and context from healthy version
        const healthyVersion = findMostRecentHealthyVersion(problem.commentId, versions);
        const anchoredInfo = healthyVersion
          ? extractAnchoredText(healthyVersion.content, problem.commentId)
          : null;

        writeDebugFile(noteId, problem.commentId, {
          originalMarkdown,
          recoveredMarkdown: result.markdown,
          state: problem.state,
          method: result.method,
          confidence: result.confidence,
          success: true,
          anchoredText: anchoredInfo?.text,
          contextBefore: anchoredInfo?.contextBefore,
          contextAfter: anchoredInfo?.contextAfter,
        });
      }
    } else {
      failed.push(problem.commentId);

      // Clean up partial anchors when recovery fails
      const cleanedMarkdown = removeAnchors(currentMarkdown, problem.commentId);
      currentMarkdown = cleanedMarkdown;

      // Write debug file for failed recovery
      if (noteId) {
        writeDebugFile(noteId, problem.commentId, {
          originalMarkdown,
          recoveredMarkdown: cleanedMarkdown,
          state: problem.state,
          success: false,
          reason: result.reason,
        });
      }
    }
  }

  return {
    markdown: currentMarkdown,
    recovered,
    failed,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
