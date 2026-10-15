import type { GitClient, MutationResult } from '../app-client';
import type { BackendTransport } from './backend-transport-types';
import { createRunMutation } from './backend-mutation';

/**
 * Validate + trim the explicit-paths param shared by `git.stage`,
 * `git.unstage`, and `git.discard`: empty lists and all-files globs
 * ('.'/'*'/'--all') are rejected upstream (mirroring the daemon contract) so
 * the request is never even sent. `verb` labels the failure message
 * ("Staging"/"Unstaging"/"Discarding").
 */
export function cleanExplicitPaths(
  paths: string[],
  verb: string,
): { ok: true; paths: string[] } | { ok: false; failure: MutationResult } {
  const cleaned = paths.map((path) => path.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return {
      ok: false,
      failure: {
        success: false,
        error: `No file paths provided; ${verb.toLowerCase()} requires explicit paths.`,
      },
    };
  }
  if (cleaned.some((path) => path === '.' || path === '*' || path.includes('--all'))) {
    return {
      ok: false,
      failure: {
        success: false,
        error: `${verb} all files is not allowed; specify explicit file paths.`,
      },
    };
  }
  return { ok: true, paths: cleaned };
}

/** Canonical explicit-path staging contract, with the renderer's transport injected. */
export function createBackendGitStageClient(
  request: BackendTransport['request'],
): Pick<GitClient, 'stage' | 'unstage'> {
  const runMutation = createRunMutation(request);
  return {
    async stage(workspaceId, paths) {
      const cleaned = cleanExplicitPaths(paths, 'Staging');
      if (!cleaned.ok) return cleaned.failure;
      return runMutation('git.stage', { workspaceId, paths: cleaned.paths });
    },
    async unstage(workspaceId, paths) {
      const cleaned = cleanExplicitPaths(paths, 'Unstaging');
      if (!cleaned.ok) return cleaned.failure;
      return runMutation('git.unstage', { workspaceId, paths: cleaned.paths });
    },
  };
}
