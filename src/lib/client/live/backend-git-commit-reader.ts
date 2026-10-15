import type { CommitDetailsResult } from '../app-client';

const fullCommitHash = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

function commitDetails(result: unknown, requestedHash: string): CommitDetailsResult {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const value = result as Record<string, unknown>;
    if (
      ['commitHash', 'author', 'authorEmail', 'date', 'message'].every(
        (key) => typeof value[key] === 'string',
      ) &&
      Array.isArray(value.files) &&
      value.files.every((path) => typeof path === 'string' && path.length > 0) &&
      Array.isArray(value.fileDetails) &&
      value.fileDetails.every((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const file = entry as Record<string, unknown>;
        return (
          typeof file.path === 'string' &&
          file.path.length > 0 &&
          typeof file.additions === 'number' &&
          Number.isSafeInteger(file.additions) &&
          file.additions >= 0 &&
          typeof file.deletions === 'number' &&
          Number.isSafeInteger(file.deletions) &&
          file.deletions >= 0
        );
      })
    ) {
      const details = result as CommitDetailsResult;
      // The documented unavailable envelope echoes the requested ref, including HEAD.
      const unavailable =
        details.commitHash === requestedHash &&
        details.author === '' &&
        details.authorEmail === '' &&
        details.date === '' &&
        details.message === '' &&
        details.files.length === 0 &&
        details.fileDetails.length === 0;
      if (
        (unavailable || fullCommitHash.test(details.commitHash)) &&
        (!fullCommitHash.test(requestedHash) ||
          details.commitHash.toLowerCase() === requestedHash.toLowerCase())
      )
        return details;
    }
  }
  // i18n-ignore (internal wire-contract diagnostic)
  throw new TypeError('Invalid git.commitDetails result');
}

/** Canonical commit inspection. Preserve wire fields and reject read failures without empty fallbacks. */
export function createBackendGitCommitReader(
  request: <T>(method: string, params: Record<string, unknown>) => Promise<T>,
) {
  return async (
    workspaceId: string,
    commitHash: string,
    options?: { gitRootId?: string },
  ): Promise<CommitDetailsResult> =>
    commitDetails(
      await request<unknown>('git.commitDetails', {
        workspaceId,
        commitHash,
        ...(options?.gitRootId ? { gitRootId: options.gitRootId } : {}),
      }),
      commitHash,
    );
}
