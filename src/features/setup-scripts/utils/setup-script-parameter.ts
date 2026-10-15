/**
 * User-facing label for a setup script sourced from the repo config.
 * Doubles as a persisted identity sentinel (saved-script name comparisons),
 * so it must stay a stable constant rather than a locale-dependent message.
 */
// i18n-ignore (persisted identity sentinel; translating breaks saved-script matching)
export const REPO_CONFIG_SCRIPT_NAME = 'From repo config';

/** Script-list entry id for the repo-config script in SetupScriptEditor. */
export const REPO_CONFIG_SCRIPT_ID = 'repo-config';

/**
 * True identity of a setup-script name, tracked by the call sites that know
 * where the name came from: `'repo-config'` for the repo-committed script,
 * `'custom'` for the empty/custom fallback, `'named'` for everything that
 * carries its own display name (saved scripts, templates, generated scripts).
 */
export type SetupScriptNameSource = 'repo-config' | 'custom' | 'named';

/**
 * Resolve the `setupScript` param for `workspace.create` (monorepo#1862).
 *
 * The script shown in the form is what runs: any trimmed non-empty script is
 * sent, EXCEPT the unedited repo-config script — the daemon executes the
 * param without persisting it (intentd#1066), and the committed
 * `.intent/config.json` already holds this script, so sending it is
 * redundant; it executes identically via the daemon's worktree-first read.
 *
 * Returns the trimmed script to send, or undefined to omit the param.
 */
export function resolveSetupScriptParam(options: {
  setupScript: string;
  setupScriptName: string;
  setupScriptNameSource: SetupScriptNameSource;
  /** An explicit empty selection must suppress the daemon's repo-config fallback. */
  explicitChoice?: boolean;
  repoPath: string | null;
  /** Cached repo-config script and the repo it was fetched for. */
  repoConfigScript: string | null;
  repoConfigScriptRepo: string | null;
}): string | undefined {
  const script = options.setupScript.trim();
  // The wire treats an empty script as omitted. A shell no-op preserves an
  // explicit empty choice without accidentally running the committed script.
  // i18n-ignore (shell command, execute-only wire override)
  if (!script) return options.explicitChoice ? 'cd .' : undefined;
  const isUneditedRepoConfigScript =
    options.setupScriptNameSource === 'repo-config' &&
    options.setupScriptName === REPO_CONFIG_SCRIPT_NAME &&
    options.repoConfigScriptRepo === options.repoPath &&
    script === (options.repoConfigScript ?? '').trim();
  return isUneditedRepoConfigScript ? undefined : script;
}
