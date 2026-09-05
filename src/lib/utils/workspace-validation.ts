/**
 * Utilities for validating workspace initialization inputs
 */

import { m } from '$shared/paraglide/messages.js';

export { parseGitHubUrl } from '$shared/utils/link-helpers';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
  suggestion?: string;
}

/**
 * Validate a branch prefix (e.g., "feature/", "user/name/")
 *
 * Branch prefixes are optional strings that get prepended to workspace branch names.
 * They must follow git ref naming rules but are allowed to end with a slash.
 *
 * Valid examples: "feature/", "user/john/", "wip-", "my-prefix/"
 * Invalid examples: "feature//", "..bad", "has space", "has:colon"
 */
export function validateBranchPrefix(prefix: string): ValidationResult {
  // Empty prefix is valid (means no prefix)
  if (!prefix || prefix.trim().length === 0) {
    return { valid: true };
  }

  const trimmed = prefix.trim();

  // Check for invalid characters in branch names (same as git ref rules)
  // Note: we allow trailing slash since it's a prefix
  const invalidChars = /[\s~^:?*\[\]\\]/;
  if (invalidChars.test(trimmed)) {
    return {
      valid: false,
      error: m.workspace_validation_branchPrefixInvalidChars_error(),
      suggestion: m.workspace_validation_branchChars_suggestion(),
    };
  }

  // Check for reserved patterns
  if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) {
    return {
      valid: false,
      error: m.workspace_validation_branchPrefixDot_error(),
    };
  }

  // Check for consecutive dots or slashes
  if (trimmed.includes('..') || trimmed.includes('//')) {
    return {
      valid: false,
      error: m.workspace_validation_branchPrefixConsecutive_error(),
    };
  }

  // Check if it starts with slash
  if (trimmed.startsWith('/')) {
    return {
      valid: false,
      error: m.workspace_validation_branchPrefixSlash_error(),
    };
  }

  // Check if it ends with .lock
  if (trimmed.endsWith('.lock')) {
    return {
      valid: false,
      error: m.workspace_validation_branchPrefixLock_error(),
    };
  }

  // Check reasonable length (git has limits, and we need room for the workspace slug)
  if (trimmed.length > 50) {
    return {
      valid: false,
      error: m.workspace_validation_branchPrefixTooLong_error(),
    };
  }

  return { valid: true };
}

/**
 * Sanitize a branch prefix to make it valid.
 * Normalizes the prefix to ensure it ends with a separator (/ or -).
 */
export function sanitizeBranchPrefix(prefix: string): string {
  if (!prefix || prefix.trim().length === 0) {
    return '';
  }

  let sanitized = prefix
    .trim()
    .replace(/^[./]+/, '') // Remove leading dots and slashes FIRST
    .replace(/[\s~^:?*\[\]\\]/g, '-') // Replace invalid chars with hyphen
    .replace(/\.{2,}/g, '-') // Replace consecutive dots
    .replace(/\/{2,}/g, '/') // Replace consecutive slashes
    .replace(/-{2,}/g, '-') // Replace multiple hyphens with single
    .replace(/^-+/, '') // Remove leading hyphens (from replaced chars)
    .replace(/\.lock$/, '') // Remove .lock suffix
    .toLowerCase();

  // If the prefix doesn't end with a separator, add one
  // Prefer / for path-like prefixes, - for others
  if (sanitized.length > 0 && !sanitized.endsWith('/') && !sanitized.endsWith('-')) {
    // If it contains a slash, it's path-like, so add /
    // Otherwise add -
    sanitized = sanitized.includes('/') ? `${sanitized}/` : `${sanitized}/`;
  }

  return sanitized;
}

/**
 * Get a user-friendly error message for common git errors
 */
export function getGitErrorMessage(error: string): string {
  const errorLower = error.toLowerCase();

  // Buffer overflow from git command output (e.g., large repos with many refs)
  if (errorLower.includes('maxbuffer')) {
    return m.workspace_gitError_maxBuffer();
  }

  // Clone-specific timeout (5 minute limit)
  if (errorLower.includes('clone') && errorLower.includes('timed out')) {
    return m.workspace_gitError_cloneTimeout();
  }

  // Transport-level timeout on workspace.create: the daemon is often still
  // finishing the creation (e.g. bootstrapping the initial agent) in the
  // background, so avoid mislabelling this as a git failure.
  if (errorLower.includes('json-rpc request timed out: workspace.create')) {
    return m.workspace_gitError_createTimeout();
  }

  // General git command timeout — only relabel when the error is actually
  // git-shaped; other JSON-RPC method timeouts fall through to the catch-all
  // below so the original error is surfaced instead of a misleading git message.
  if (
    errorLower.includes('timed out') &&
    ['git', 'clone', 'fetch', 'worktree', 'pull', 'push', 'rebase', 'merge'].some((keyword) =>
      errorLower.includes(keyword),
    )
  ) {
    return m.workspace_gitError_gitTimeout();
  }

  // Clone failed with non-zero exit code
  if (errorLower.includes('git clone failed')) {
    if (errorLower.includes('could not read from remote')) {
      return m.workspace_gitError_cloneRemote();
    }
    if (
      errorLower.includes('authentication') ||
      errorLower.includes('permission denied') ||
      errorLower.includes('access denied')
    ) {
      return m.workspace_gitError_cloneAuth();
    }
    return m.workspace_gitError_cloneFailed();
  }

  // Worktree ref resolution failure
  if (errorLower.includes('could not resolve any ref to create worktree')) {
    return m.workspace_gitError_worktreeRef();
  }

  // File system errors
  if (errorLower.includes('failed to write file')) {
    if (errorLower.includes('eacces') || errorLower.includes('permission denied')) {
      return m.workspace_gitError_writePermission();
    }
    if (errorLower.includes('enospc') || errorLower.includes('disk space')) {
      return m.workspace_gitError_diskSpaceFree();
    }
    if (errorLower.includes('enoent') || errorLower.includes('no such file')) {
      return m.workspace_gitError_writeNoEnt();
    }
    // Return the full error message for file write errors to show the underlying cause
    return error;
  }

  if (errorLower.includes('failed to read file')) {
    if (errorLower.includes('enoent') || errorLower.includes('no such file')) {
      return m.workspace_gitError_readNotFound();
    }
    if (errorLower.includes('eacces') || errorLower.includes('permission denied')) {
      return m.workspace_gitError_readPermission();
    }
    return error;
  }

  if (errorLower.includes('permission denied')) {
    return m.workspace_gitError_permissionDenied();
  }

  if (errorLower.includes('not found') || errorLower.includes('enoent')) {
    return m.workspace_gitError_notFound();
  }

  if (errorLower.includes('already exists')) {
    return m.workspace_gitError_alreadyExists();
  }

  if (errorLower.includes('network') || errorLower.includes('etimedout')) {
    return m.workspace_gitError_network();
  }

  if (errorLower.includes('authentication') || errorLower.includes('401')) {
    // Preserve the original message if it mentions private repos (more informative)
    if (errorLower.includes('private repositor')) {
      return error;
    }
    return m.workspace_gitError_authFailed();
  }

  if (errorLower.includes('rate limit') || errorLower.includes('403')) {
    return m.workspace_gitError_rateLimit();
  }

  if (errorLower.includes('disk space') || errorLower.includes('enospc')) {
    return m.workspace_gitError_diskSpace();
  }

  return error;
}
