/**
 * Utilities for parsing git branch output.
 *
 * Git branch output has specific formatting that needs careful parsing:
 * - Local branches: "  branch-name" or "* branch-name" (current) or "+ branch-name" (worktree)
 * - Remote branches: "  origin/branch-name" or "  origin/HEAD -> origin/main"
 */

/**
 * Parse a branch name from git branch output, stripping any prefix characters.
 *
 * Git branch output format:
 * - "  branch-name" - regular branch (leading spaces)
 * - "* branch-name" - current branch (asterisk prefix)
 * - "+ branch-name" - branch checked out in a linked worktree (plus prefix)
 *
 * @param line - A single line from `git branch` output
 * @returns The branch name without prefix characters, or empty string if invalid
 *
 * @example
 * parseBranchName("  main") // "main"
 * parseBranchName("* main") // "main"
 * parseBranchName("+ feature-branch") // "feature-branch"
 * parseBranchName("") // ""
 */
export function parseBranchName(line: string): string {
  // Strip leading whitespace and git status indicators:
  // - space: regular branch
  // - * (asterisk): current branch
  // - + (plus): branch checked out in a linked worktree
  return line.replace(/^[\s*+]+/, '').trim();
}

/**
 * Parse a remote branch name from git branch -r output.
 *
 * Git remote branch output format:
 * - "  origin/branch-name" - regular remote branch
 * - "  origin/HEAD -> origin/main" - HEAD reference (should be skipped)
 *
 * @param line - A single line from `git branch -r` output
 * @param remotePrefix - The remote prefix to strip (e.g., "origin/")
 * @returns The branch name without the remote prefix, or null if invalid/should be skipped
 *
 * @example
 * parseRemoteBranchName("  origin/main", "origin/") // "main"
 * parseRemoteBranchName("  origin/HEAD -> origin/main", "origin/") // null (HEAD reference)
 * parseRemoteBranchName("  upstream/main", "origin/") // null (wrong remote)
 * parseRemoteBranchName("", "origin/") // null (empty)
 */
export function parseRemoteBranchName(line: string, remotePrefix: string): string | null {
  const trimmed = line.trim();

  // Skip empty lines
  if (!trimmed) {
    return null;
  }

  // Skip HEAD references (e.g., "origin/HEAD -> origin/main")
  if (trimmed.includes(' -> ')) {
    return null;
  }

  // Check if it starts with the expected remote prefix
  if (!trimmed.startsWith(remotePrefix)) {
    return null;
  }

  // Remove the remote prefix to get the local branch name
  return trimmed.substring(remotePrefix.length);
}

/**
 * Escape special regex characters in a string.
 * This ensures the string can be safely used in a RegExp constructor.
 *
 * @param str - The string to escape
 * @returns The escaped string safe for use in RegExp
 *
 * @example
 * escapeRegExp("auth-fix") // "auth-fix" (hyphen is safe)
 * escapeRegExp("test.branch") // "test\\.branch" (dot escaped)
 * escapeRegExp("feature[1]") // "feature\\[1\\]" (brackets escaped)
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create a regex pattern that matches a base slug and its numeric suffixes.
 *
 * @param baseSlug - The base slug to match (will be escaped for regex safety)
 * @returns A RegExp that matches the base slug or base slug with numeric suffix
 *
 * @example
 * const pattern = createSlugPattern("auth-fix");
 * pattern.test("auth-fix") // true
 * pattern.test("auth-fix-2") // true
 * pattern.test("auth-fix-123") // true
 * pattern.test("auth-fixer") // false
 * pattern.test("auth-fix-feature") // false
 */
export function createSlugPattern(baseSlug: string): RegExp {
  const escapedBaseSlug = escapeRegExp(baseSlug);
  return new RegExp(`^${escapedBaseSlug}(-\\d+)?$`);
}

/**
 * Create a regex pattern that captures the numeric suffix from a branch name.
 *
 * @param baseSlug - The base slug to match (will be escaped for regex safety)
 * @returns A RegExp with a capture group for the numeric suffix
 *
 * @example
 * const pattern = createSuffixCapturePattern("auth-fix");
 * "auth-fix-42".match(pattern)?.[1] // "42"
 * "auth-fix".match(pattern) // null (no suffix)
 */
export function createSuffixCapturePattern(baseSlug: string): RegExp {
  const escapedBaseSlug = escapeRegExp(baseSlug);
  return new RegExp(`^${escapedBaseSlug}-(\\d+)$`);
}
