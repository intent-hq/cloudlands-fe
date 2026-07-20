/**
 * Repo-committed setup script detection (`.intent/config.json`).
 *
 * The new-workspace modal runs BEFORE any workspace exists, so the daemon's
 * workspaceId-scoped `repoConfig.get` RPC cannot serve it. Instead the repo
 * config is read path-based over `setup-scripts:read-repo-config` (bridged in
 * `repo-config-bridge-seeder.ts`) and parsed tolerantly here, mirroring
 * intentd's `read_repo_config`: a missing file, invalid JSON, a non-object
 * root, or a missing/blank `setupScript` all fold to "no script" — never an
 * error surfaced to the caller.
 */
import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';

/** User-facing label for a setup script sourced from the repo config. */
export const REPO_CONFIG_SCRIPT_NAME = 'From repo config';

/** Script-list entry id for the repo-config script in SetupScriptEditor. */
export const REPO_CONFIG_SCRIPT_ID = 'repo-config';

/**
 * Extract `setupScript` from raw `.intent/config.json` content.
 *
 * Tolerant like intentd's `read_repo_config`: invalid JSON, a non-object root
 * (array/string/number/null), or a missing/non-string/blank `setupScript`
 * all return null.
 */
export function parseRepoConfigSetupScript(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const setupScript = (parsed as Record<string, unknown>).setupScript;
  return typeof setupScript === 'string' && setupScript.trim().length > 0 ? setupScript : null;
}

/** Envelope returned by the `setup-scripts:read-repo-config` bridge. */
interface ReadRepoConfigResponse {
  success?: boolean;
  data?: { content?: string | null };
}

/**
 * Read the committed setup script for a local repo path. Resolves null for
 * any failure (no `.intent/config.json`, invalid JSON, transport error) —
 * callers fall back to last-used / template defaults.
 */
export async function fetchRepoConfigSetupScript(repoPath: string): Promise<string | null> {
  if (!repoPath) return null;
  try {
    const response = await invoke<ReadRepoConfigResponse>(
      IPC_CHANNELS.SETUP_SCRIPTS.READ_REPO_CONFIG,
      { repoPath },
    );
    const content = response?.success ? response.data?.content : null;
    return typeof content === 'string' ? parseRepoConfigSetupScript(content) : null;
  } catch {
    return null;
  }
}

/** A resolved default setup script selection for the initializer. */
export interface SetupScriptChoice {
  content: string;
  name: string;
}

/**
 * Resolve the default setup script for a freshly selected repo.
 * Priority: repo-committed `setupScript` > last-used script for the repo >
 * generic "Copy config files only" template > empty custom.
 */
export function chooseDefaultSetupScript(options: {
  repoConfigScript: string | null;
  lastUsed: { name: string; content: string } | undefined;
  genericTemplate: { name: string; content: string } | undefined;
}): SetupScriptChoice {
  const { repoConfigScript, lastUsed, genericTemplate } = options;
  if (repoConfigScript) {
    return { content: repoConfigScript, name: REPO_CONFIG_SCRIPT_NAME };
  }
  if (lastUsed) {
    return { content: lastUsed.content, name: lastUsed.name };
  }
  if (genericTemplate) {
    return { content: genericTemplate.content, name: genericTemplate.name };
  }
  return { content: '', name: 'Custom' };
}
