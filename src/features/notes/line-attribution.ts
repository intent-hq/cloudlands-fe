import { diffTrimmedLines } from 'diff';
import type { NoteVersion } from '../../shared/types';

/**
 * Represents the attribution of a single line to a version
 */
export interface LineAttribution {
  /** Line number (1-based) */
  lineNumber: number;
  /** Content of the line */
  lineContent: string;
  /** Version that last modified this line (null if older than version history) */
  version: NoteVersion | null;
  /** True if the line differs from the attributed version only in whitespace */
  isWhitespaceOnly: boolean;
}

/**
 * Build a mapping from current line numbers to version line numbers
 *
 * Uses diffTrimmedLines to ignore whitespace when mapping positions,
 * ensuring that "Line 2" and "  Line 2" are treated as the same line.
 *
 * @param versionContent - Content from the version
 * @param currentContent - Current content
 * @returns Map from current line number to version line number (null if line was added after version)
 */
function buildLineMapping(
  versionContent: string,
  currentContent: string,
): Map<number, number | null> {
  // Normalize: ensure both strings end with newline for consistent diffing
  // This prevents diffLines from treating "Line 1" vs "Line 1\nLine 2" as completely different
  const normalizeContent = (content: string) => {
    if (content === '') return '';
    return content.endsWith('\n') ? content : `${content}\n`;
  };

  const normalizedVersion = normalizeContent(versionContent);
  const normalizedCurrent = normalizeContent(currentContent);

  // Use diffTrimmedLines to ignore whitespace when mapping line positions
  // This ensures that "Line 2" and "  Line 2" are treated as the same line
  const diff = diffTrimmedLines(normalizedVersion, normalizedCurrent);
  const mapping = new Map<number, number | null>();

  let currentLineNum = 1;
  let versionLineNum = 1;

  for (const change of diff) {
    const lineCount = change.count || 0;

    if (change.added) {
      // Lines added in current (didn't exist in version)
      for (let i = 0; i < lineCount; i++) {
        mapping.set(currentLineNum++, null);
      }
    } else if (change.removed) {
      // Lines removed from version (skip in current)
      versionLineNum += lineCount;
    } else {
      // Unchanged lines - map current to version
      for (let i = 0; i < lineCount; i++) {
        mapping.set(currentLineNum++, versionLineNum++);
      }
    }
  }

  return mapping;
}

/**
 * Check if a line's content differs between version and current only in whitespace
 */
function isWhitespaceOnlyChange(versionLine: string, currentLine: string): boolean {
  return versionLine.trim() === currentLine.trim() && versionLine !== currentLine;
}

/**
 * Attribute each line in current content to the version that last modified it
 *
 * Algorithm:
 * 1. Walk backwards through versions (newest to oldest)
 * 2. For each line in current document, determine which version last modified it
 * 3. Use diffTrimmedLines to track how line numbers change between versions
 * 4. Handle whitespace-only changes by marking them but attributing to earlier version
 *
 * @param currentContent - Current content of the note
 * @param versions - Array of versions, ordered from oldest to newest
 * @returns Array of line attributions
 */
export function attributeLines(currentContent: string, versions: NoteVersion[]): LineAttribution[] {
  const currentLines = currentContent.split('\n');
  const attributions: LineAttribution[] = [];

  // Initialize all lines as unattributed
  for (let i = 0; i < currentLines.length; i++) {
    attributions.push({
      lineNumber: i + 1,
      lineContent: currentLines[i],
      version: null,
      isWhitespaceOnly: false,
    });
  }

  // Handle empty content
  if (currentLines.length === 0 || (currentLines.length === 1 && currentLines[0] === '')) {
    return [];
  }

  // Handle no versions
  if (versions.length === 0) {
    return attributions;
  }

  // Walk backwards through versions (newest to oldest)
  for (let v = versions.length - 1; v >= 0; v--) {
    const version = versions[v];
    const prevVersion = v > 0 ? versions[v - 1] : null;

    // Build mapping from current lines to this version's lines
    const currentToVersionMapping = buildLineMapping(version.content, currentContent);

    // Build mapping from this version's lines to previous version's lines (if exists)
    const versionToPrevMapping = prevVersion
      ? buildLineMapping(prevVersion.content, version.content)
      : null;

    const versionLines = version.content.split('\n');
    const prevVersionLines = prevVersion ? prevVersion.content.split('\n') : [];

    // For each line in current document
    for (let i = 0; i < currentLines.length; i++) {
      const currentLineNum = i + 1;
      const currentLine = currentLines[i];

      // Skip if already attributed
      if (attributions[i].version !== null) {
        continue;
      }

      const versionLineNum = currentToVersionMapping.get(currentLineNum);

      if (versionLineNum === null || versionLineNum === undefined) {
        // Line was added after this version, keep looking backwards
        continue;
      }

      const versionLine = versionLines[versionLineNum - 1];

      // Check if this line was changed in this version
      let wasChangedInThisVersion = false;
      let isWhitespaceChange = false;

      if (!prevVersion) {
        // First version - everything is new
        wasChangedInThisVersion = true;
      } else if (versionToPrevMapping) {
        const prevLineNum = versionToPrevMapping.get(versionLineNum);

        if (prevLineNum === null || prevLineNum === undefined) {
          // Line was added in this version
          wasChangedInThisVersion = true;
        } else {
          const prevLine = prevVersionLines[prevLineNum - 1];
          // Check if content differs
          if (versionLine !== prevLine) {
            // Check if it's only whitespace that changed
            if (versionLine.trim() === prevLine.trim()) {
              // Whitespace-only change - don't attribute, but mark it
              isWhitespaceChange = true;
            } else {
              // Real content change
              wasChangedInThisVersion = true;
            }
          }
        }
      }

      if (wasChangedInThisVersion) {
        // Attribute to this version
        attributions[i].version = version;
        // Preserve isWhitespaceOnly if it was already set (from a later whitespace-only change)
        if (!attributions[i].isWhitespaceOnly) {
          attributions[i].isWhitespaceOnly = false;
        }
      } else if (isWhitespaceChange && attributions[i].version === null) {
        // Whitespace-only change - mark it but continue looking backwards
        // We'll attribute to the version where content was actually introduced
        attributions[i].isWhitespaceOnly = true;
      } else if (!prevVersion && attributions[i].version === null) {
        // First version and line exists - attribute to it
        attributions[i].version = version;
        // Check if current content differs only in whitespace from this version
        attributions[i].isWhitespaceOnly = isWhitespaceOnlyChange(versionLine, currentLine);
      }
    }
  }

  return attributions;
}
