import * as Diff from 'diff';

export type LineStagingSide = 'additions' | 'deletions';
export type LineStagingStage = string;

interface HunkLine {
  content: string;
  oldLine: number | null;
  newLine: number | null;
  type: 'context' | 'addition' | 'deletion';
}

interface GenerateLinePatchOptions {
  filePath: string;
  oldContent: string;
  newContent: string;
  stage: LineStagingStage;
  startLine: number;
  endLine: number;
  side?: LineStagingSide;
  lineOffset?: number;
}

export function getChangedLineNumbersFromContent(
  filePath: string,
  oldContent: string,
  newContent: string,
  lineOffset = 1,
): { additions: Set<number>; deletions: Set<number> } {
  const fullPatch = Diff.createPatch(filePath, oldContent, newContent, '', '', { context: 3 });
  const additions = new Set<number>();
  const deletions = new Set<number>();
  const lineDelta = normalizeLineOffset(lineOffset) - 1;

  const lines = fullPatch.split('\n');
  let currentNewLine = 0;
  let currentOldLine = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        currentOldLine = parseInt(match[1], 10);
        currentNewLine = parseInt(match[2], 10);
      }
    } else if (inHunk) {
      if (line.startsWith('+')) {
        additions.add(currentNewLine + lineDelta);
        currentNewLine++;
      } else if (line.startsWith('-')) {
        deletions.add(currentOldLine + lineDelta);
        currentOldLine++;
      } else if (line.startsWith(' ')) {
        currentNewLine++;
        currentOldLine++;
      }
    }
  }

  return { additions, deletions };
}

export function generateLinePatchFromContent({
  filePath,
  oldContent,
  newContent,
  stage,
  startLine,
  endLine,
  side,
  lineOffset = 1,
}: GenerateLinePatchOptions): string | null {
  const contextLines = 3;
  const normalizedLineOffset = normalizeLineOffset(lineOffset);
  const lineDelta = normalizedLineOffset - 1;
  const localStartLine = Math.max(1, startLine - lineDelta);
  const localEndLine = Math.max(localStartLine, endLine - lineDelta);

  const fullPatch = Diff.createPatch(filePath, oldContent, newContent, '', '', {
    context: contextLines,
  });

  const lines = fullPatch.split('\n');
  const isNewFile = oldContent === '' && normalizedLineOffset === 1;
  const gitHeaders = isNewFile
    ? [
        `diff --git a/${filePath} b/${filePath}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${filePath}`,
      ]
    : [`diff --git a/${filePath} b/${filePath}`, `--- a/${filePath}`, `+++ b/${filePath}`];

  const allHunkLines = parseHunkLines(lines);
  const targetRange = findTargetRange(allHunkLines, localStartLine, localEndLine, side);
  if (!targetRange) return null;

  const { targetStartIdx, targetEndIdx } = targetRange;
  const contextBefore = collectContextBefore(allHunkLines, targetStartIdx, contextLines);
  const targetLines = allHunkLines.slice(targetStartIdx, targetEndIdx + 1);
  const contextAfter = collectContextAfter(allHunkLines, targetEndIdx, contextLines);

  if (contextAfter.length < contextLines) {
    addTrailingContext({
      contextAfter,
      contextBefore,
      allHunkLines,
      targetEndIdx,
      contextLines,
      stage,
      oldContent,
      newContent,
    });
  }

  const selectedLines = [...contextBefore, ...targetLines, ...contextAfter];
  if (selectedLines.length === 0) return null;

  const { firstOldLine, firstNewLine, oldCount, newCount } = calculateHunkHeader(selectedLines);
  const hunkHeader = `@@ -${firstOldLine + lineDelta},${oldCount} +${firstNewLine + lineDelta},${newCount} @@`;
  const patchContent = selectedLines.map((hl) => hl.content).join('\n');

  return [...gitHeaders, hunkHeader, patchContent].join('\n') + '\n';
}

function normalizeLineOffset(lineOffset: number): number {
  return Number.isFinite(lineOffset) && lineOffset > 1 ? Math.floor(lineOffset) : 1;
}

function parseHunkLines(lines: string[]): HunkLine[] {
  const allHunkLines: HunkLine[] = [];
  let inHunk = false;
  let currentNewLine = 0;
  let currentOldLine = 0;

  for (const line of lines) {
    if (
      line.startsWith('Index:') ||
      line.startsWith('===') ||
      line.startsWith('---') ||
      line.startsWith('+++')
    ) {
      continue;
    } else if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        currentOldLine = parseInt(match[1], 10);
        currentNewLine = parseInt(match[2], 10);
        inHunk = true;
      }
    } else if (inHunk && line !== '') {
      if (line.startsWith('+')) {
        allHunkLines.push({
          content: line,
          oldLine: null,
          newLine: currentNewLine,
          type: 'addition',
        });
        currentNewLine++;
      } else if (line.startsWith('-')) {
        allHunkLines.push({
          content: line,
          oldLine: currentOldLine,
          newLine: null,
          type: 'deletion',
        });
        currentOldLine++;
      } else if (line.startsWith(' ')) {
        allHunkLines.push({
          content: line,
          oldLine: currentOldLine,
          newLine: currentNewLine,
          type: 'context',
        });
        currentNewLine++;
        currentOldLine++;
      }
    }
  }

  return allHunkLines;
}

function findTargetRange(
  allHunkLines: HunkLine[],
  startLine: number,
  endLine: number,
  side?: LineStagingSide,
): { targetStartIdx: number; targetEndIdx: number } | null {
  let targetStartIdx = -1;
  let targetEndIdx = -1;

  for (let i = 0; i < allHunkLines.length; i++) {
    const hl = allHunkLines[i];
    const lineNum = hl.newLine ?? hl.oldLine;
    if (lineNum !== null && lineNum >= startLine && lineNum <= endLine) {
      const isAddition = hl.type === 'addition';
      const isDeletion = hl.type === 'deletion';
      if (side === 'additions' && !isAddition) continue;
      if (side === 'deletions' && !isDeletion) continue;
      if (isAddition || isDeletion) {
        if (targetStartIdx === -1) targetStartIdx = i;
        targetEndIdx = i;
      }
    }
  }

  return targetStartIdx === -1 ? null : { targetStartIdx, targetEndIdx };
}

function collectContextBefore(
  allHunkLines: HunkLine[],
  targetStartIdx: number,
  contextLines: number,
): HunkLine[] {
  const contextBefore: HunkLine[] = [];
  for (let i = targetStartIdx - 1; i >= 0 && contextBefore.length < contextLines; i--) {
    const hl = allHunkLines[i];
    if (hl.type === 'context') contextBefore.unshift(hl);
    else break;
  }
  return contextBefore;
}

function collectContextAfter(
  allHunkLines: HunkLine[],
  targetEndIdx: number,
  contextLines: number,
): HunkLine[] {
  const contextAfter: HunkLine[] = [];
  for (
    let i = targetEndIdx + 1;
    i < allHunkLines.length && contextAfter.length < contextLines;
    i++
  ) {
    const hl = allHunkLines[i];
    if (hl.type === 'context') contextAfter.push(hl);
    else break;
  }
  return contextAfter;
}

function addTrailingContext({
  contextAfter,
  contextBefore,
  allHunkLines,
  targetEndIdx,
  contextLines,
  stage,
  oldContent,
  newContent,
}: {
  contextAfter: HunkLine[];
  contextBefore: HunkLine[];
  allHunkLines: HunkLine[];
  targetEndIdx: number;
  contextLines: number;
  stage: LineStagingStage;
  oldContent: string;
  newContent: string;
}) {
  const isUnstaging = stage === 'staged';
  const content = isUnstaging ? newContent : oldContent;
  const contentLines = content.split('\n');
  let lastLine = 0;
  const lastContextAfter = contextAfter[contextAfter.length - 1];
  const contextAfterLine = isUnstaging ? lastContextAfter?.newLine : lastContextAfter?.oldLine;

  if (contextAfterLine) {
    lastLine = contextAfterLine;
  } else {
    for (let i = targetEndIdx; i >= 0; i--) {
      const hl = allHunkLines[i];
      const line = isUnstaging ? hl.newLine : hl.oldLine;
      if (line !== null) {
        lastLine = line;
        break;
      }
    }
  }

  if (lastLine === 0) {
    const lastContextLine = contextBefore[contextBefore.length - 1];
    const line = isUnstaging ? lastContextLine?.newLine : lastContextLine?.oldLine;
    if (line) lastLine = line;
  }

  const neededContextLines = contextLines - contextAfter.length;
  for (let i = 0; i < neededContextLines; i++) {
    const lineIdx = lastLine + i;
    if (lineIdx < contentLines.length) {
      contextAfter.push({
        content: ' ' + contentLines[lineIdx],
        oldLine: isUnstaging ? null : lineIdx + 1,
        newLine: isUnstaging ? lineIdx + 1 : null,
        type: 'context',
      });
    }
  }
}

function calculateHunkHeader(selectedLines: HunkLine[]): {
  firstOldLine: number;
  firstNewLine: number;
  oldCount: number;
  newCount: number;
} {
  let firstOldLine = 0;
  let firstNewLine = 0;
  let oldCount = 0;
  let newCount = 0;

  for (const hl of selectedLines) {
    if (hl.oldLine !== null && firstOldLine === 0) firstOldLine = hl.oldLine;
    if (hl.newLine !== null && firstNewLine === 0) firstNewLine = hl.newLine;
    if (hl.type === 'deletion') oldCount++;
    else if (hl.type === 'addition') newCount++;
    else {
      oldCount++;
      newCount++;
    }
  }

  if (firstOldLine === 0) firstOldLine = firstNewLine > 0 ? firstNewLine - 1 : 1;
  if (firstNewLine === 0) firstNewLine = firstOldLine;

  return { firstOldLine, firstNewLine, oldCount, newCount };
}
