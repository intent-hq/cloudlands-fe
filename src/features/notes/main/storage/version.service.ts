/**
 * Version Service
 *
 * Manages version history for notes using JSONL format.
 * - Snapshots: Full content at a point in time
 * - Diffs: Line-based unified diffs between versions
 * - Auto-compaction: Keeps max 50 versions, creates snapshots every 10
 * - Error recovery: Skips corrupted JSONL lines gracefully
 * - Atomic writes: Uses temp file + rename for crash safety
 */

import { Logger } from '../../../../shared/logger';
import type { VersionEntry, VersionAuthor } from './note-storage.types';
import { VERSION_CONFIG } from './note-storage.types';
import {
  writeFileAtomic,
  appendFileAtomic,
  readFileSafe,
} from './atomic-file';

const logger = new Logger('VersionService');

/**
 * Append a new version to the JSONL file
 */
export async function appendVersion(
  versionsFile: string,
  content: string,
  author: VersionAuthor,
  title?: string,
): Promise<VersionEntry> {
  // Read existing versions to determine next version number and type
  const versions = await readVersions(versionsFile);
  const nextVersion = versions.length > 0 ? versions[versions.length - 1].v + 1 : 1;

  // Determine if this should be a snapshot or diff
  const shouldSnapshot =
    versions.length === 0 ||
    nextVersion % VERSION_CONFIG.SNAPSHOT_INTERVAL === 1 ||
    !versions.some((v) => v.type === 'snapshot');

  let entry: VersionEntry;

  if (shouldSnapshot) {
    entry = {
      type: 'snapshot',
      v: nextVersion,
      date: new Date().toISOString(),
      author,
      content,
      title,
    };
  } else {
    // Find last snapshot or reconstruct content
    const previousContent = await reconstructContent(versions, versions.length);
    const diff = createDiff(previousContent, content);

    entry = {
      type: 'diff',
      v: nextVersion,
      date: new Date().toISOString(),
      author,
      diff,
    };
  }

  // Append to file
  await appendToJsonl(versionsFile, entry);

  // Prune if needed
  if (versions.length >= VERSION_CONFIG.MAX_VERSIONS) {
    await pruneVersions(versionsFile, versions.concat(entry));
  }

  return entry;
}

/**
 * Read all versions from JSONL file with error recovery.
 * Corrupted lines are skipped and logged as warnings.
 */
export async function readVersions(versionsFile: string): Promise<VersionEntry[]> {
  const content = await readFileSafe(versionsFile);
  if (content === null) {
    return [];
  }

  const versions: VersionEntry[] = [];
  const lines = content.split('\n');
  let corruptedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const entry = JSON.parse(line) as VersionEntry;
      // Validate required fields
      if (entry.v !== undefined && entry.type && entry.date) {
        versions.push(entry);
      } else {
        corruptedCount++;
        logger.warn('Skipping invalid version entry (missing required fields)', {
          line: i + 1,
          content: line.slice(0, 100),
        });
      }
    } catch (error) {
      corruptedCount++;
      logger.warn('Skipping corrupted JSONL line', {
        line: i + 1,
        error: error instanceof Error ? error.message : 'Unknown error',
        content: line.slice(0, 100),
      });
    }
  }

  if (corruptedCount > 0) {
    logger.warn('Version file had corrupted entries', {
      file: versionsFile,
      corruptedCount,
      validCount: versions.length,
    });
  }

  return versions;
}

/**
 * Get content at a specific version
 */
export async function getContentAtVersion(
  versionsFile: string,
  version: number,
): Promise<string | null> {
  const versions = await readVersions(versionsFile);
  return reconstructContent(versions, version);
}

/**
 * Reconstruct content at a given version index
 */
async function reconstructContent(
  versions: VersionEntry[],
  targetVersion: number,
): Promise<string> {
  // Find the most recent snapshot at or before target
  let snapshotIndex = -1;
  let baseContent = '';

  for (let i = 0; i < versions.length && versions[i].v <= targetVersion; i++) {
    if (versions[i].type === 'snapshot') {
      snapshotIndex = i;
      baseContent = versions[i].content || '';
    }
  }

  if (snapshotIndex === -1) {
    return ''; // No snapshot found
  }

  // Apply diffs from snapshot to target
  let content = baseContent;
  for (let i = snapshotIndex + 1; i < versions.length && versions[i].v <= targetVersion; i++) {
    const entry = versions[i];
    if (entry.type === 'diff' && entry.diff) {
      content = applyDiff(content, entry.diff);
    }
  }

  return content;
}

/**
 * Append entry to JSONL file using atomic append
 */
async function appendToJsonl(file: string, entry: VersionEntry): Promise<void> {
  const line = `${JSON.stringify(entry)}\n`;
  await appendFileAtomic(file, line);
}

/**
 * Prune old versions, keeping at least one snapshot.
 * Uses atomic write for crash safety.
 */
async function pruneVersions(versionsFile: string, versions: VersionEntry[]): Promise<void> {
  if (versions.length <= VERSION_CONFIG.MAX_VERSIONS) return;

  // Keep the most recent MAX_VERSIONS, but ensure at least one snapshot
  const toKeep = versions.slice(-VERSION_CONFIG.MAX_VERSIONS);

  // If no snapshot in kept versions, add the most recent snapshot from pruned
  if (!toKeep.some((v) => v.type === 'snapshot')) {
    const prunedSnapshots = versions
      .slice(0, -VERSION_CONFIG.MAX_VERSIONS)
      .filter((v) => v.type === 'snapshot');
    if (prunedSnapshots.length > 0) {
      toKeep.unshift(prunedSnapshots[prunedSnapshots.length - 1]);
    }
  }

  // Rewrite file atomically
  const content = `${toKeep.map((v) => JSON.stringify(v)).join('\n')}\n`;
  await writeFileAtomic(versionsFile, content);

  logger.debug('Pruned versions', {
    originalCount: versions.length,
    keptCount: toKeep.length,
  });
}

/**
 * Create a simple line-based diff
 * Uses a basic LCS (Longest Common Subsequence) approach
 */
function createDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const hunks: string[] = [];
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    // Find next difference
    while (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
    }

    if (i >= oldLines.length && j >= newLines.length) break;

    // Record the hunk
    const hunkStart = `@@ -${i + 1} +${j + 1} @@`;
    const hunkLines: string[] = [hunkStart];

    // Track starting positions to detect deadlock
    const startI = i;
    const startJ = j;

    // Collect removed lines
    while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      // Check if this line exists later in newLines (using indexOf with start index to avoid slice allocation)
      const foundIndex = newLines.indexOf(oldLines[i], j);
      const foundLater = foundIndex === -1 ? -1 : foundIndex - j;
      if (foundLater === -1 || foundLater > 3) {
        hunkLines.push(`-${oldLines[i]}`);
        i++;
      } else {
        break;
      }
    }

    // Collect added lines
    while (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
      const foundIndex = oldLines.indexOf(newLines[j], i);
      const foundLater = foundIndex === -1 ? -1 : foundIndex - i;
      if (foundLater === -1 || foundLater > 3) {
        hunkLines.push(`+${newLines[j]}`);
        j++;
      } else {
        break;
      }
    }

    // Deadlock prevention: if neither index advanced, force progress by treating as replacement
    if (i === startI && j === startJ) {
      if (i < oldLines.length) {
        hunkLines.push(`-${oldLines[i]}`);
        i++;
      }
      if (j < newLines.length) {
        hunkLines.push(`+${newLines[j]}`);
        j++;
      }
    }

    if (hunkLines.length > 1) {
      hunks.push(hunkLines.join('\n'));
    }
  }

  return hunks.join('\n');
}

/**
 * Apply a diff to content to produce new content
 */
function applyDiff(content: string, diff: string): string {
  if (!diff.trim()) return content;

  const lines = content.split('\n');
  const diffLines = diff.split('\n');

  let lineOffset = 0;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];

    if (line.startsWith('@@')) {
      // Parse hunk header: @@ -oldStart +newStart @@
      const match = line.match(/@@ -(\d+) \+(\d+) @@/);
      if (match) {
        const oldStart = parseInt(match[1], 10) - 1;
        let currentLine = oldStart + lineOffset;

        // Process hunk lines
        i++;
        while (i < diffLines.length && !diffLines[i].startsWith('@@')) {
          const hunkLine = diffLines[i];
          if (hunkLine.startsWith('-')) {
            // Remove line
            if (currentLine < lines.length) {
              lines.splice(currentLine, 1);
              lineOffset--;
            }
          } else if (hunkLine.startsWith('+')) {
            // Add line
            lines.splice(currentLine, 0, hunkLine.slice(1));
            currentLine++;
            lineOffset++;
          }
          i++;
        }
        i--; // Back up to re-process @@ line
      }
    }
  }

  return lines.join('\n');
}

/**
 * Check if content has changed significantly enough to warrant a new version
 */
export function hasSignificantChanges(oldContent: string, newContent: string): boolean {
  if (oldContent === newContent) return false;

  // Always version if content changed by more than a few characters
  const lengthDiff = Math.abs(oldContent.length - newContent.length);
  if (lengthDiff > 10) return true;

  // Check line-level changes
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const lineDiff = Math.abs(oldLines.length - newLines.length);

  return lineDiff > 0 || oldContent !== newContent;
}
