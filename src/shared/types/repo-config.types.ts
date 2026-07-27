/**
 * Repo-committed `.intent/config.json` schema (`RepoConfig`).
 *
 * Daemon-parity types: mirrors `RepoConfig` / `RepoScript` in intentd's
 * `intent-core/src/model.rs` (camelCase on the wire). The daemon owns the
 * full schema and behavior; these types/schemas exist so the FE can parse and
 * round-trip repo configs without stripping known or unknown fields — the
 * schemas use `.passthrough()` to preserve keys other tools add.
 */
import { z } from 'zod';

/** Script mode for repo scripts (service = long-running, command = run-once). */
export const RepoScriptModeSchema = z.enum(['service', 'command']);
export type RepoScriptMode = z.infer<typeof RepoScriptModeSchema>;

/** Script category for repo scripts. */
export const RepoScriptCategorySchema = z.enum([
  'dev',
  'build',
  'test',
  'lint',
  'typecheck',
  'format',
  'storybook',
  'other',
]);
export type RepoScriptCategory = z.infer<typeof RepoScriptCategorySchema>;

/**
 * Per-repository script definition (parity with intentd `RepoScript`).
 * Scripts can be seeded into workspace script storage.
 *
 * Note: `.passthrough()` here is deliberately *more* preserving than the
 * daemon — `RepoScript` in `model.rs` has no `#[serde(flatten)] extra`, so
 * the daemon drops unknown keys inside script entries on round-trip. The FE
 * keeps them (the safer choice for a file other tools may edit).
 */
export const RepoScriptSchema = z
  .object({
    name: z.string(),
    command: z.string(),
    mode: RepoScriptModeSchema,
    category: RepoScriptCategorySchema.optional(),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
    autoStart: z.boolean().optional(),
  })
  .passthrough();
export type RepoScript = z.infer<typeof RepoScriptSchema>;

/**
 * Per-repository configuration stored in `.intent/config.json` in a repo
 * root (parity with intentd `RepoConfig`). All fields are optional; missing
 * fields fall back to global app settings or none. Unknown keys are preserved
 * on read→write round-trip (`.passthrough()`), matching the daemon's
 * `#[serde(flatten)] extra` behavior.
 */
export const RepoConfigSchema = z
  .object({
    /** Branch prefix for new workspaces (e.g. "feature/"); overrides the global setting. */
    branchPrefix: z.string().optional(),
    /** Default setup script to run after creating a git worktree. */
    setupScript: z.string().optional(),
    /** General instructions for AI agents working in this repo. */
    instructions: z.string().optional(),
    /** Script to run the project in development mode. */
    runScript: z.string().optional(),
    /** Script to run when archiving/cleaning up a workspace. */
    archiveScript: z.string().optional(),
    /** Shared script definitions for this repo. */
    scripts: z.array(RepoScriptSchema).optional(),
    /**
     * Repo-root-relative directory prefixes excluded from CoW checkout
     * provisioning: matching directories are not cloned into the checkout
     * (e.g. huge caches). `.git` and the repo root itself cannot be excluded
     * (the daemon ignores such entries with a warning). Absent ⇒ clone
     * everything.
     */
    cowCloneExclude: z.array(z.string()).optional(),
  })
  .passthrough();
export type RepoConfig = z.infer<typeof RepoConfigSchema>;
