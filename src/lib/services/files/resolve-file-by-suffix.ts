/**
 * Suffix-based file path resolution for not-found reads.
 *
 * When a `file.read` 404s (e.g. a reference authored against a submodule or
 * worktree root, like `crates/...` instead of `packages/intentd/crates/...`),
 * search the workspace for files whose path ends with the requested path. The
 * normal source path uses `search.fileNames` (PROTOCOL §5.15). Media paths also
 * use bounded `file.list` calls below known artifact roots because filename
 * search honors ignore rules. Errors surface as empty results — never fabricated data.
 */
import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import type { FileNode } from '$shared/types';

const logger = createLogger('ResolveFileBySuffix');

/** Cap on `search.fileNames` results fetched for one resolution attempt. */
const SEARCH_LIMIT = 50;
const ARTIFACT_ROOTS = ['.demo-artifacts', 'artifacts'] as const;
const ARTIFACT_MAX_DEPTH = 4;
const ARTIFACT_MAX_ENTRIES = 256;
const ARTIFACT_MAX_CALLS = 24;
const ARTIFACT_MAX_LATENCY_MS = 750;
const MEDIA_EXTENSION_PATTERN = /\.(?:jpe?g|png|gif|webp|mp4|webm)$/i;

/** Suffix-resolution outcome: matching candidates plus an incomplete-result signal. */
export interface SuffixResolution {
  candidates: string[];
  /**
   * `true` when filename results or bounded artifact traversal may be incomplete.
   * Even a single match is then not provably unique and must never auto-retarget.
   */
  truncated: boolean;
}

function normalizePath(path: string): string | null {
  const slashed = path
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '');
  if (!slashed || slashed.startsWith('/') || /^[a-z]:\//i.test(slashed)) return null;
  const segments = slashed.split('/').filter((segment) => segment && segment !== '.');
  if (segments.length === 0 || segments.some((segment) => segment === '..')) return null;
  return segments.join('/');
}

function artifactRelativeRequest(path: string): string {
  for (const root of ARTIFACT_ROOTS) {
    if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  }
  return path;
}

function isArtifactRooted(path: string): boolean {
  return ARTIFACT_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

function safeChildName(node: FileNode): string | null {
  const name = node.name.replace(/\\/g, '/');
  if (!name || name === '.' || name === '..' || name.includes('/')) return null;
  return name;
}

async function listBeforeDeadline(
  workspaceId: string,
  path: string,
  deadline: number,
): Promise<FileNode[] | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      appClient.files.listDirectory(workspaceId, path),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), remaining);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveFromArtifactRoots(
  workspaceId: string,
  requestedPath: string,
): Promise<SuffixResolution> {
  const requestSuffix = artifactRelativeRequest(requestedPath);
  const basenameOnly = !requestSuffix.includes('/');
  const queue: Array<{ path: string; depth: number }> = ARTIFACT_ROOTS.map((path) => ({
    path,
    depth: 0,
  }));
  const files: string[] = [];
  const deadline = Date.now() + ARTIFACT_MAX_LATENCY_MS;
  let calls = 0;
  let entries = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (calls >= ARTIFACT_MAX_CALLS || entries >= ARTIFACT_MAX_ENTRIES) {
      truncated = true;
      break;
    }
    const directory = queue.shift()!;
    calls += 1;
    const children = await listBeforeDeadline(workspaceId, directory.path, deadline);
    if (!children) {
      truncated = true;
      break;
    }
    for (const child of children) {
      entries += 1;
      if (entries > ARTIFACT_MAX_ENTRIES) {
        truncated = true;
        break;
      }
      const name = safeChildName(child);
      if (!name) continue;
      const childPath = `${directory.path}/${name}`;
      if (child.type === 'directory') {
        if (directory.depth < ARTIFACT_MAX_DEPTH) {
          queue.push({ path: childPath, depth: directory.depth + 1 });
        } else {
          truncated = true;
        }
      } else {
        files.push(childPath);
      }
    }
  }

  const candidates = files.filter((candidate) => {
    if (candidate === requestedPath) return false;
    if (basenameOnly) return candidate.split('/').pop() === requestSuffix;
    return candidate.endsWith(`/${requestSuffix}`);
  });
  return { candidates: [...new Set(candidates)].sort(), truncated };
}

async function resolveFromSearch(
  workspaceId: string,
  normalized: string,
): Promise<SuffixResolution> {
  try {
    const result = await backendRequest<{ files?: string[]; truncated?: boolean }>(
      'search.fileNames',
      { workspaceId, pattern: normalized, limit: SEARCH_LIMIT },
    );
    const files = Array.isArray(result?.files) ? result.files : [];
    const candidates = files.flatMap((candidate) => {
      const normalizedCandidate = normalizePath(candidate);
      return normalizedCandidate &&
        normalizedCandidate !== normalized &&
        normalizedCandidate.endsWith(`/${normalized}`)
        ? [normalizedCandidate]
        : [];
    });
    return {
      candidates: [...new Set(candidates)].sort(),
      truncated: result?.truncated === true,
    };
  } catch (error) {
    logger.error('Failed to resolve file by suffix', error);
    return { candidates: [], truncated: false };
  }
}

/**
 * Resolve a not-found workspace-relative path to candidate real paths.
 *
 * Searches `search.fileNames` with the full normalized relative path — the
 * daemon substring-matches the whole relative path, so this narrows results
 * to real suffix matches and makes truncation far less likely than a bare
 * basename would for common names (e.g. `index.ts`). Candidates are filtered
 * to those ending with `/<requested path>`; a candidate equal to the
 * requested path itself (the path that just 404'd) is excluded so neither
 * the saga nor the UI ever surfaces it. Returns the matches plus the
 * search's `truncated` flag — the caller decides whether a unique match
 * auto-resolves (only safe when not truncated) or an ambiguous list is
 * surfaced as an error.
 */
export async function resolveFileBySuffix(
  workspaceId: string,
  path: string,
): Promise<SuffixResolution> {
  const normalized = normalizePath(path);
  if (!normalized) return { candidates: [], truncated: false };

  const isMedia = MEDIA_EXTENSION_PATTERN.test(normalized);
  if (isArtifactRooted(normalized) || (isMedia && !normalized.includes('/'))) {
    return resolveFromArtifactRoots(workspaceId, normalized);
  }

  const search = await resolveFromSearch(workspaceId, normalized);
  if (search.candidates.length > 0 || search.truncated || !isMedia) return search;
  return resolveFromArtifactRoots(workspaceId, normalized);
}
