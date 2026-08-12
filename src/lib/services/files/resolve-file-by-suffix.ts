/**
 * Suffix-based file path resolution for not-found reads.
 *
 * When a `file.read` 404s (e.g. a reference authored against a submodule or
 * worktree root, like `crates/...` instead of `packages/intentd/crates/...`),
 * search the workspace for files whose path ends with the requested path via
 * `search.fileNames` (PROTOCOL §5.15) and return the matching
 * workspace-relative candidates. Errors surface as empty results — never
 * fabricated data.
 */
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('ResolveFileBySuffix');

/** Cap on `search.fileNames` results fetched for one resolution attempt. */
const SEARCH_LIMIT = 50;

function normalizePath(path: string): string {
  return path.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
}

/**
 * Resolve a not-found workspace-relative path to candidate real paths.
 *
 * Searches `search.fileNames` with the path's basename and filters to
 * candidates whose normalized path equals the requested path or ends with
 * `/<requested path>`. Returns all matches — the caller decides whether a
 * unique match auto-resolves or an ambiguous list is surfaced as an error.
 */
export async function resolveFileBySuffix(workspaceId: string, path: string): Promise<string[]> {
  const normalized = normalizePath(path);
  const baseName = normalized.split('/').pop();
  if (!baseName) return [];
  try {
    const result = await backendRequest<{ files?: string[] }>('search.fileNames', {
      workspaceId,
      pattern: baseName,
      limit: SEARCH_LIMIT,
    });
    const files = Array.isArray(result?.files) ? result.files : [];
    return files.filter((candidate) => {
      const normalizedCandidate = normalizePath(candidate);
      return normalizedCandidate === normalized || normalizedCandidate.endsWith(`/${normalized}`);
    });
  } catch (error) {
    logger.error('Failed to resolve file by suffix', error);
    return [];
  }
}
