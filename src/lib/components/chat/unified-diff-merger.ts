/**
 * Unified Diff Merger
 *
 * Merges multiple change parts (staged, unstaged, committed) for the same file
 * into a single unified diff view where each line is annotated with its stage.
 *
 * The git change flow is:
 * HEAD → (staged) → INDEX → (unstaged) → Working Tree
 *
 * This utility merges hunks from different stages, deduplicates context lines,
 * and produces a single sequence of lines with stage annotations.
 */

import type { ChangeCategory, DiffHunk, DiffLine, ChangePart } from './types';

/** A line in the merged diff with stage annotation */
export interface MergedDiffLine {
  /** Line type: addition, deletion, or context */
  type: 'Addition' | 'Deletion' | 'Context';
  /** The line content (without +/- prefix) */
  content: string;
  /** Line number in the "old" reference (HEAD for staged, INDEX for unstaged) */
  oldLineNumber?: number;
  /** Line number in the "new" reference (INDEX for staged, WT for unstaged) */
  newLineNumber?: number;
  /** Which stage this change belongs to */
  stage: ChangeCategory;
  /** Original hunk index (for hunk-level actions) */
  hunkIndex?: number;
}

/** A merged hunk containing lines from potentially multiple stages */
export interface MergedHunk {
  /** Start line in HEAD (original file) */
  headStart: number;
  /** Number of lines from HEAD perspective */
  headLines: number;
  /** Start line in Working Tree (final file) */
  wtStart: number;
  /** Number of lines from WT perspective */
  wtLines: number;
  /** The merged lines */
  lines: MergedDiffLine[];
  /** Stages present in this hunk */
  stages: Set<ChangeCategory>;
}

/**
 * Represents a line position in the merged view.
 * We track both HEAD and WT line numbers.
 */
interface LinePosition {
  headLine: number | null;
  indexLine: number | null;
  wtLine: number | null;
}

/**
 * Compute line numbers for a hunk's lines based on the hunk header.
 * The server doesn't always include line numbers, so we compute them.
 */
function computeLineNumbers(
  hunk: DiffHunk,
): Array<DiffLine & { oldLineNumber?: number; newLineNumber?: number }> {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;

  return hunk.lines.map((line) => {
    const result: DiffLine & { oldLineNumber?: number; newLineNumber?: number } = {
      ...line,
      // Also handle oldNumber/newNumber from server format
      oldLineNumber: (line as any).oldLineNumber ?? (line as any).oldNumber,
      newLineNumber: (line as any).newLineNumber ?? (line as any).newNumber,
    };

    // If line numbers weren't provided, compute them
    if (result.oldLineNumber === undefined && result.newLineNumber === undefined) {
      if (line.type === 'Context') {
        result.oldLineNumber = oldLine++;
        result.newLineNumber = newLine++;
      } else if (line.type === 'Deletion') {
        result.oldLineNumber = oldLine++;
      } else if (line.type === 'Addition') {
        result.newLineNumber = newLine++;
      }
    } else {
      // Update counters based on existing line numbers
      if (line.type === 'Context') {
        oldLine = (result.oldLineNumber ?? oldLine) + 1;
        newLine = (result.newLineNumber ?? newLine) + 1;
      } else if (line.type === 'Deletion') {
        oldLine = (result.oldLineNumber ?? oldLine) + 1;
      } else if (line.type === 'Addition') {
        newLine = (result.newLineNumber ?? newLine) + 1;
      }
    }

    return result;
  });
}

/**
 * Build synthetic DiffHunk entries from oldContent/newContent strings.
 * Used when a change part has content but no pre-computed chunks (e.g., committed chat changes).
 */
export function buildSyntheticChunks(oldContent: string, newContent: string): DiffHunk[] {
  const oldLines = oldContent ? oldContent.split('\n') : [];
  const newLines = newContent ? newContent.split('\n') : [];

  if (oldLines.length === 0 && newLines.length === 0) return [];

  const lines: DiffLine[] = [];

  // All old lines as deletions
  for (const line of oldLines) {
    lines.push({ type: 'Deletion', content: line });
  }

  // All new lines as additions
  for (const line of newLines) {
    lines.push({ type: 'Addition', content: line });
  }

  return [
    {
      oldStart: 1,
      oldLines: oldLines.length,
      newStart: 1,
      newLines: newLines.length,
      lines,
    },
  ];
}

/**
 * Merge multiple change parts into a unified diff view.
 *
 * @param parts - The change parts to merge (staged, unstaged, committed)
 * @returns An array of merged hunks with per-line stage annotations
 */
export function mergeChangeParts(parts: ChangePart[]): MergedHunk[] {
  if (!parts || parts.length === 0) return [];

  // For now, use a simpler approach: interleave the hunks based on line numbers
  // Sort all hunks by their starting position
  const allHunks: Array<{
    hunk: DiffHunk;
    stage: ChangeCategory;
    part: ChangePart;
    hunkIndex: number;
  }> = [];

  for (const part of parts) {
    let chunks = part.change.chunks || [];

    // If no chunks but we have oldContent/newContent, generate synthetic chunks
    if (chunks.length === 0 && (part.change.oldContent != null || part.change.newContent != null)) {
      chunks = buildSyntheticChunks(part.change.oldContent ?? '', part.change.newContent ?? '');
    }

    chunks.forEach((hunk, hunkIndex) => {
      allHunks.push({ hunk, stage: part.category, part, hunkIndex });
    });
  }

  // If no hunks, return empty
  if (allHunks.length === 0) {
    return [];
  }

  // Sort by newStart (position in the target file)
  allHunks.sort((a, b) => a.hunk.newStart - b.hunk.newStart);

  // Convert to merged hunks, computing line numbers
  const mergedHunks: MergedHunk[] = [];

  for (const { hunk, stage, hunkIndex } of allHunks) {
    // Compute line numbers for this hunk
    const linesWithNumbers = computeLineNumbers(hunk);

    const mergedLines: MergedDiffLine[] = linesWithNumbers.map((line) => ({
      type: line.type,
      content: line.content,
      oldLineNumber: line.oldLineNumber,
      newLineNumber: line.newLineNumber,
      stage,
      hunkIndex,
    }));

    mergedHunks.push({
      headStart: hunk.oldStart,
      headLines: hunk.oldLines,
      wtStart: hunk.newStart,
      wtLines: hunk.newLines,
      lines: mergedLines,
      stages: new Set([stage]),
    });
  }

  // Merge overlapping hunks (hunks that share line ranges)
  return mergeOverlappingHunks(mergedHunks);
}

/**
 * Merge hunks that have overlapping line ranges.
 * This deduplicates context lines and creates a single hunk for overlapping regions.
 */
function mergeOverlappingHunks(hunks: MergedHunk[]): MergedHunk[] {
  if (hunks.length <= 1) return hunks;

  const result: MergedHunk[] = [];
  let current = hunks[0];

  for (let i = 1; i < hunks.length; i++) {
    const next = hunks[i];
    const currentEnd = current.wtStart + current.wtLines;
    const nextStart = next.wtStart;

    // Check if hunks overlap or are adjacent (with some context buffer)
    if (nextStart <= currentEnd + 3) {
      // Merge the hunks
      current = mergeTwo(current, next);
    } else {
      result.push(current);
      current = next;
    }
  }
  result.push(current);

  return result;
}

/**
 * Merge two adjacent or overlapping hunks into one.
 */
function mergeTwo(a: MergedHunk, b: MergedHunk): MergedHunk {
  // Build a map of lines by their "new" line number to detect duplicates
  const linesByNewNum = new Map<number, MergedDiffLine>();
  const linesByOldNum = new Map<number, MergedDiffLine>();

  // Process hunk A first
  for (const line of a.lines) {
    if (line.newLineNumber !== undefined) {
      linesByNewNum.set(line.newLineNumber, line);
    }
    if (line.oldLineNumber !== undefined && line.type !== 'Addition') {
      linesByOldNum.set(line.oldLineNumber, line);
    }
  }

  // Process hunk B, skipping duplicate context lines
  const mergedLines: MergedDiffLine[] = [...a.lines];

  for (const line of b.lines) {
    // For context lines, check if we already have this line
    if (line.type === 'Context') {
      const existingByNew =
        line.newLineNumber !== undefined ? linesByNewNum.get(line.newLineNumber) : undefined;
      const existingByOld =
        line.oldLineNumber !== undefined ? linesByOldNum.get(line.oldLineNumber) : undefined;

      if (existingByNew?.type === 'Context' || existingByOld?.type === 'Context') {
        // Skip duplicate context line
        continue;
      }
    }

    mergedLines.push(line);

    // Track this line
    if (line.newLineNumber !== undefined) {
      linesByNewNum.set(line.newLineNumber, line);
    }
    if (line.oldLineNumber !== undefined && line.type !== 'Addition') {
      linesByOldNum.set(line.oldLineNumber, line);
    }
  }

  // Sort lines by their position (prefer newLineNumber, fall back to oldLineNumber)
  mergedLines.sort((x, y) => {
    const xPos = x.newLineNumber ?? x.oldLineNumber ?? 0;
    const yPos = y.newLineNumber ?? y.oldLineNumber ?? 0;
    return xPos - yPos;
  });

  // Combine stages
  const stages = new Set([...a.stages, ...b.stages]);

  // Calculate new bounds
  const headStart = Math.min(a.headStart, b.headStart);
  const wtStart = Math.min(a.wtStart, b.wtStart);
  const headEnd = Math.max(a.headStart + a.headLines, b.headStart + b.headLines);
  const wtEnd = Math.max(a.wtStart + a.wtLines, b.wtStart + b.wtLines);

  return {
    headStart,
    headLines: headEnd - headStart,
    wtStart,
    wtLines: wtEnd - wtStart,
    lines: mergedLines,
    stages,
  };
}

/**
 * Get the display color for a stage category
 */
export function getStageColor(stage: ChangeCategory): {
  bar: string;
  text: string;
  bg: string;
} {
  switch (stage) {
    case 'staged':
      return {
        bar: 'bg-emerald-500',
        text: 'text-emerald-600 dark:text-emerald-400',
        bg: 'bg-emerald-500/10',
      };
    case 'unstaged':
      return {
        bar: 'bg-amber-500',
        text: 'text-amber-600 dark:text-amber-400',
        bg: 'bg-amber-500/10',
      };
    case 'committed':
    default:
      return {
        bar: 'bg-blue-500',
        text: 'text-blue-600 dark:text-blue-400',
        bg: 'bg-blue-500/10',
      };
  }
}

/**
 * Convert merged hunks back to a unified patch string.
 * This allows us to pass the merged diff to DiffViewer.
 */
export function mergedHunksToPatch(hunks: MergedHunk[], fileName: string = 'file'): string {
  if (hunks.length === 0) return '';

  let patch = `diff --git a/${fileName} b/${fileName}\n`;
  patch += `--- a/${fileName}\n`;
  patch += `+++ b/${fileName}\n`;

  for (const hunk of hunks) {
    // Hunk header
    patch += `@@ -${hunk.headStart},${hunk.headLines} +${hunk.wtStart},${hunk.wtLines} @@\n`;

    // Lines
    for (const line of hunk.lines) {
      let prefix = ' ';
      if (line.type === 'Addition') prefix = '+';
      else if (line.type === 'Deletion') prefix = '-';
      patch += `${prefix}${line.content}\n`;
    }
  }

  return patch;
}

/**
 * Build oldContent and newContent from merged hunks.
 * This reconstructs the file contents that DiffViewer needs.
 */
export function buildContentFromMergedHunks(hunks: MergedHunk[]): {
  oldContent: string;
  newContent: string;
} {
  const oldLines: string[] = [];
  const newLines: string[] = [];

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'Context') {
        oldLines.push(line.content);
        newLines.push(line.content);
      } else if (line.type === 'Deletion') {
        oldLines.push(line.content);
      } else if (line.type === 'Addition') {
        newLines.push(line.content);
      }
    }
  }

  return {
    oldContent: oldLines.join('\n'),
    newContent: newLines.join('\n'),
  };
}
