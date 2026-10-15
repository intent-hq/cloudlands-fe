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
import { m } from '$shared/paraglide/messages.js';

import {
  REPO_CONFIG_SCRIPT_NAME,
  type SetupScriptNameSource,
} from './utils/setup-script-parameter';
// Compatibility surface for existing initializer and setup-script callers.
export {
  REPO_CONFIG_SCRIPT_NAME,
  REPO_CONFIG_SCRIPT_ID,
  resolveSetupScriptParam,
  type SetupScriptNameSource,
} from './utils/setup-script-parameter';

/**
 * Localized display label for a setup-script name. Localizes only when the
 * entry's true identity (`source`) is a sentinel — `'repo-config'` and
 * `'custom'` map to their localized messages; `'named'` passes the name
 * through unchanged, so a user-saved script literally named "From repo
 * config" or "Custom" keeps its own name. Display-only — identity
 * comparisons and saved-script matching must keep using the English
 * sentinel constants.
 */
export function setupScriptDisplayName(name: string, source: SetupScriptNameSource): string {
  if (source === 'repo-config') {
    return m.workspace_setupScriptEditor_fromRepoConfig_name();
  }
  if (source === 'custom') {
    return m.workspace_setupScriptEditor_custom_name();
  }
  return name;
}

/**
 * Typed subset of the repo-committed `.intent/config.json` that the frontend
 * consumes. The daemon owns the full schema; the FE only reads `setupScript`
 * (deferred typing item from cloudlands-fe#417 review).
 */
export interface RepoConfigSubset {
  /** Committed setup script — null when missing, blank, or not a string. */
  setupScript: string | null;
}

/**
 * Narrow loosely-shaped config data (parsed `.intent/config.json` or the
 * `config` object from `github.repoConfig.get`) to the typed subset.
 * Tolerant like intentd's `read_repo_config`: a non-object root
 * (array/string/number/null) or a missing/non-string/blank `setupScript`
 * folds to null.
 */
export function toRepoConfigSubset(config: unknown): RepoConfigSubset {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { setupScript: null };
  }
  const setupScript = (config as Record<string, unknown>).setupScript;
  return {
    setupScript:
      typeof setupScript === 'string' && setupScript.trim().length > 0 ? setupScript : null,
  };
}

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
  return toRepoConfigSubset(parsed).setupScript;
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

/**
 * Read the committed setup script for a GitHub repo with no local checkout
 * (`github.repoConfig.get`, PROTOCOL §5.27, via the AppClient
 * integrations domain). `ref` is forwarded when provided; the daemon defaults
 * to the repo's default branch. Resolves null for any failure (missing file,
 * unauthenticated private repo, transport error) — callers fall back to
 * last-used / template defaults, mirroring `fetchRepoConfigSetupScript`.
 */
export async function fetchGitHubRepoConfigSetupScript(
  owner: string,
  repo: string,
  ref?: string,
): Promise<string | null> {
  if (!owner || !repo) return null;
  try {
    const { appClient } = await import('$lib/client');
    const result = await appClient.integrations.githubRepoConfig(owner, repo, ref);
    return toRepoConfigSubset(result.config).setupScript;
  } catch {
    return null;
  }
}

/** A resolved default setup script selection for the initializer. */
export interface SetupScriptChoice {
  content: string;
  name: string;
  /** Which branch produced the name — drives display-label localization. */
  source: SetupScriptNameSource;
}

/**
 * Resolve the default setup script for a freshly selected repo.
 * Priority: repo-committed `setupScript` > last-used script for the repo >
 * generic "Copy config files only" template > empty custom.
 */
export function chooseDefaultSetupScript(options: {
  repoConfigScript: string | null;
  lastUsed: { name: string; content: string; nameSource?: SetupScriptNameSource } | undefined;
  genericTemplate: { name: string; content: string } | undefined;
}): SetupScriptChoice {
  const { repoConfigScript, lastUsed, genericTemplate } = options;
  if (repoConfigScript) {
    return { content: repoConfigScript, name: REPO_CONFIG_SCRIPT_NAME, source: 'repo-config' };
  }
  if (lastUsed) {
    return {
      content: lastUsed.content,
      name: lastUsed.nameSource === 'repo-config' ? 'Custom' : lastUsed.name,
      source: lastUsed.nameSource === 'repo-config' ? 'custom' : (lastUsed.nameSource ?? 'named'),
    };
  }
  if (genericTemplate) {
    return { content: genericTemplate.content, name: genericTemplate.name, source: 'named' };
  }
  return { content: '', name: 'Custom', source: 'custom' };
}
