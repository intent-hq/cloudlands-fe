/**
 * Per-Repository Configuration Types
 *
 * Defines the shape of `.intent/config.json` files that live in git repositories.
 * This config is committable and shared across the team.
 *
 * The `.intent/` directory in a repo root contains:
 * - `config.json` — shared repo config (committable)
 * - `.gitignore` — excludes everything except config.json and .gitignore
 * - (future) notes, context, etc. — excluded from git by default
 */

/**
 * Per-repo configuration stored in `.intent/config.json`
 *
 * All fields are optional — missing fields fall back to global app settings.
 */
export interface RepoConfig {
  /**
   * Branch prefix for new workspaces created from this repo.
   * Overrides the global branch prefix setting.
   * @example "feature/" → branches like "feature/auth-refactor"
   * @example "aw/" → branches like "aw/dark-forest"
   */
  branchPrefix?: string;

  /**
   * Default setup script to run after creating a git worktree.
   * Available variables: $MAIN_CHECKOUT, $WORKTREE_PATH, $BRANCH_NAME
   * @example "#!/bin/bash\ncp \"$MAIN_CHECKOUT/.env\" .env\npnpm install"
   */
  setupScript?: string;

  /**
   * General instructions for AI agents working in this repo.
   * Appended to the system prompt for all agents.
   * @example "This is a Next.js 14 app using the app router. Always use server components by default."
   */
  instructions?: string;

  /**
   * Script to run the project in development mode.
   * Used by agents to start dev servers.
   * @example "pnpm dev"
   */
  runScript?: string;

  /**
   * Script to run when archiving/cleaning up a workspace.
   * Runs before the worktree is removed.
   * @example "docker compose down"
   */
  archiveScript?: string;
}

/**
 * The directory name used for Intent config in repos.
 */
export const REPO_INTENT_DIR = '.intent';

/**
 * The config file name within the .intent directory.
 */
export const REPO_CONFIG_FILENAME = 'config.json';

/**
 * Default .gitignore content for the .intent directory.
 * Excludes everything except the config file and the .gitignore itself.
 */
export const REPO_INTENT_GITIGNORE = `# Intent workspace config directory
# Only config.json is tracked in git — everything else is local
*
!.gitignore
!config.json
`;
