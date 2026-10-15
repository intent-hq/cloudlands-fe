import { LineType, type DiffChunk, type DiffLine } from '$shared/types';
import type { GitClient } from '../app-client';

function invalidResult(): never {
  // i18n-ignore (internal wire-contract diagnostic)
  throw new TypeError('Invalid git.diffs result');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResult();
  return value as Record<string, unknown>;
}

function lineNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalidResult();
  return value;
}

function toDiffLine(raw: unknown): DiffLine {
  const line = record(raw);
  if (
    (line.type !== LineType.Addition &&
      line.type !== LineType.Deletion &&
      line.type !== LineType.Context) ||
    typeof line.content !== 'string'
  )
    invalidResult();
  const out: DiffLine = { type: line.type, content: line.content };
  if (line.oldNumber !== undefined) out.oldNumber = lineNumber(line.oldNumber);
  if (line.newNumber !== undefined) out.newNumber = lineNumber(line.newNumber);
  return out;
}

function toDiffChunks(result: unknown): DiffChunk[] {
  if (!Array.isArray(result)) invalidResult();
  return result.map((entry) => {
    const file = record(entry);
    if (typeof file.path !== 'string' || !file.path || !Array.isArray(file.hunks)) invalidResult();
    const out: DiffChunk = {
      file: file.path,
      chunks: file.hunks.map((entry) => {
        const hunk = record(entry);
        if (!Array.isArray(hunk.lines)) invalidResult();
        return {
          oldStart: lineNumber(hunk.oldStart),
          oldLines: lineNumber(hunk.oldLines),
          newStart: lineNumber(hunk.newStart),
          newLines: lineNumber(hunk.newLines),
          lines: hunk.lines.map(toDiffLine),
        };
      }),
    };
    for (const key of ['isBinary', 'isTooLarge'] as const) {
      if (file[key] === undefined) continue;
      if (typeof file[key] !== 'boolean') invalidResult();
      out[key] = file[key];
    }
    for (const key of ['oldContent', 'newContent'] as const) {
      if (file[key] === undefined) continue;
      if (typeof file[key] !== 'string') invalidResult();
      out[key] = file[key];
    }
    return out;
  });
}

/** Canonical option shaping and parsed-hunk mapping; transport/contract failures stay failures. */
export function createBackendGitDiffReader(
  request: <T>(method: string, params: Record<string, unknown>) => Promise<T>,
): GitClient['diffs'] {
  return async (workspaceId, options) => {
    const params: Record<string, unknown> = { workspaceId };
    if (options?.path) params.path = options.path;
    if (options?.paths?.length) params.paths = options.paths;
    if (options?.staged === true) params.staged = true;
    if (options?.commitHash) params.commitHash = options.commitHash;
    if (options?.gitRootId) params.gitRootId = options.gitRootId;
    return toDiffChunks(await request<unknown>('git.diffs', params));
  };
}
