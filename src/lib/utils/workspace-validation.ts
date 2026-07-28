/**
 * Utilities for validating workspace initialization inputs
 */

import { createLogger } from './client-logger';
import { invoke } from '$shared/generated/ipc-client';
import { m } from '$shared/paraglide/messages.js';

const logger = createLogger('WorkspaceValidation');

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
  suggestion?: string;
}

export interface DirectoryStatus {
  exists: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  isGitRepo: boolean;
  path: string;
  parentGitRoot?: string;
  relativePathFromGitRoot?: string;
  isSubdirectoryOfGitRepo: boolean;
}

export interface RepoValidationResult extends ValidationResult {
  isNewRepo?: boolean;
  directoryStatus?: DirectoryStatus;
}

/**
 * Validate a repository path (local or GitHub)
 * @param path - The path to validate
 * @param allowNewRepo - If true, allows paths that don't exist yet (for new repo creation)
 */
export async function validateRepoPath(
  path: string,
  allowNewRepo: boolean = false,
): Promise<RepoValidationResult> {
  if (!path || path.trim().length === 0) {
    return {
      valid: false,
      error: m.workspace_validation_repoPathRequired_error(),
      suggestion: m.workspace_validation_repoPathRequired_suggestion(),
    };
  }

  const trimmedPath = path.trim();

  // Check if it's a GitHub URL
  if (isGitHubUrl(trimmedPath)) {
    return validateGitHubUrl(trimmedPath);
  }

  // Otherwise, treat as local path
  return validateLocalPath(trimmedPath, allowNewRepo);
}

/**
 * Check if a string looks like a GitHub URL
 */
export function isGitHubUrl(url: string): boolean {
  const patterns = [
    /^https?:\/\/github\.com\//i,
    /^git@github\.com:/i,
    /^github\.com\//i,
    /^([a-zA-Z0-9\-_]+)\/([a-zA-Z0-9\-_\.]+)$/, // owner/repo format
  ];

  return patterns.some((pattern) => pattern.test(url.trim()));
}

/**
 * Parse GitHub URL into owner and repo
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim();

  // Handle various GitHub URL formats
  const patterns = [
    /^https?:\/\/github\.com\/([^\/]+)\/([^\/\.]+)(\.git)?$/i,
    /^git@github\.com:([^\/]+)\/([^\/\.]+)(\.git)?$/i,
    /^github\.com\/([^\/]+)\/([^\/\.]+)(\.git)?$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }
  }

  // Check for simple owner/repo format
  const simpleMatch = trimmed.match(/^([a-zA-Z0-9\-_]+)\/([a-zA-Z0-9\-_\.]+)$/);
  if (simpleMatch && !trimmed.includes('\\') && !trimmed.includes(':')) {
    return { owner: simpleMatch[1], repo: simpleMatch[2] };
  }

  return null;
}

/**
 * Validate a GitHub URL
 */
async function validateGitHubUrl(url: string): Promise<ValidationResult> {
  const parsed = parseGitHubUrl(url);

  if (!parsed) {
    return {
      valid: false,
      error: m.workspace_validation_invalidGithubUrl_error(),
      suggestion: m.workspace_validation_invalidGithubUrl_suggestion(),
    };
  }

  // Could add API validation here if needed
  return {
    valid: true,
    warning: m.workspace_validation_githubCloneLocally_warning(),
  };
}

/**
 * Validate a local file path
 * @param path - The path to validate
 * @param allowNewRepo - If true, allows paths that don't exist yet (for new repo creation)
 */
async function validateLocalPath(
  path: string,
  allowNewRepo: boolean = false,
): Promise<RepoValidationResult> {
  // Basic path validation
  if (path.includes('\0')) {
    return {
      valid: false,
      error: m.workspace_validation_nullCharacters_error(),
    };
  }

  // Check if path looks reasonable
  if (
    !path.startsWith('/') &&
    !path.startsWith('~') &&
    !path.startsWith('.') &&
    !path.includes(':\\')
  ) {
    return {
      valid: false,
      error: m.workspace_validation_pathNotAbsolute_error(),
      suggestion: m.workspace_validation_pathNotAbsolute_suggestion(),
    };
  }

  // In Electron environment, check directory status
  if (typeof window !== 'undefined' && window.electronAPI) {
    try {
      const statusResult = await invoke<any>('file:getDirectoryStatus', { path });

      if (statusResult.success && statusResult.data) {
        const status: DirectoryStatus = statusResult.data;

        // Path doesn't exist
        if (!status.exists) {
          if (allowNewRepo) {
            return {
              valid: true,
              isNewRepo: true,
              directoryStatus: status,
              warning: m.workspace_validation_willCreateRepo_warning(),
            };
          }
          return {
            valid: false,
            error: m.workspace_validation_dirNotExist_error(),
            suggestion: m.workspace_validation_dirNotExist_suggestion(),
            directoryStatus: status,
          };
        }

        // Path exists but is not a directory
        if (!status.isDirectory) {
          return {
            valid: false,
            error: m.workspace_validation_notDirectory_error(),
            suggestion: m.workspace_validation_notDirectory_suggestion(),
            directoryStatus: status,
          };
        }

        // Path exists and is a directory - check git status
        if (!status.isGitRepo) {
          // Check if directory is inside a parent git repository
          if (status.isSubdirectoryOfGitRepo) {
            // Directory is inside a parent git repo - don't initialize a new repo
            return {
              valid: true,
              isNewRepo: false,
              directoryStatus: status,
              warning: m.workspace_validation_insideParentRepo_warning({
                path: status.parentGitRoot ?? '',
              }),
            };
          }

          // Directory exists but is not a git repo and not inside a parent repo
          if (status.isEmpty) {
            // Empty directory - will create new repo
            return {
              valid: true,
              isNewRepo: true,
              directoryStatus: status,
              warning: m.workspace_validation_emptyDirInit_warning(),
            };
          }
          // Non-empty, non-git directory
          return {
            valid: true,
            isNewRepo: true,
            directoryStatus: status,
            warning: m.workspace_validation_nonGitDirInit_warning(),
          };
        }

        // It's an existing git repository
        return {
          valid: true,
          isNewRepo: false,
          directoryStatus: status,
        };
      }

      // Fall back to legacy check if new API fails
      const result = await invoke<any>('file:exists', { path });
      if (!result.exists) {
        if (allowNewRepo) {
          return {
            valid: true,
            isNewRepo: true,
            warning: m.workspace_validation_willCreateRepo_warning(),
          };
        }
        return {
          valid: false,
          error: m.workspace_validation_dirNotExist_error(),
          suggestion: m.workspace_validation_dirNotExistLegacy_suggestion(),
        };
      }

      // Check if it's a git repository
      const gitCheck = await invoke<any>('git:isRepository', { path });
      if (!gitCheck.isRepository) {
        return {
          valid: true,
          isNewRepo: true,
          warning: m.workspace_validation_nonGitInit_warning(),
        };
      }
    } catch (err) {
      logger.warn('Could not validate path existence', err);
      // Don't fail validation if we can't check
    }
  }

  return { valid: true, isNewRepo: false };
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
 * Validate a branch name
 */
export function validateBranchName(branch: string): ValidationResult {
  if (!branch || branch.trim().length === 0) {
    return {
      valid: false,
      error: m.workspace_validation_branchNameRequired_error(),
    };
  }

  const trimmed = branch.trim();

  // Check for invalid characters in branch names
  const invalidChars = /[\s~^:?*\[\]\\]/;
  if (invalidChars.test(trimmed)) {
    return {
      valid: false,
      error: m.workspace_validation_branchNameInvalidChars_error(),
      suggestion: m.workspace_validation_branchChars_suggestion(),
    };
  }

  // Check for reserved names
  const reserved = ['HEAD', '.', '..'];
  if (reserved.includes(trimmed)) {
    return {
      valid: false,
      error: m.workspace_validation_branchNameReserved_error(),
    };
  }

  // Check for consecutive dots or slashes
  if (trimmed.includes('..') || trimmed.includes('//')) {
    return {
      valid: false,
      error: m.workspace_validation_branchNameConsecutive_error(),
    };
  }

  // Check if it starts or ends with slash
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) {
    return {
      valid: false,
      error: m.workspace_validation_branchNameSlash_error(),
    };
  }

  // Check if it ends with .lock
  if (trimmed.endsWith('.lock')) {
    return {
      valid: false,
      error: m.workspace_validation_branchNameLock_error(),
    };
  }

  return { valid: true };
}

/**
 * Sanitize a branch name to make it valid
 */
export function sanitizeBranchName(branch: string): string {
  return branch
    .trim()
    .replace(/[\s~^:?*\[\]\\]/g, '-') // Replace invalid chars with hyphen
    .replace(/\.{2,}/g, '-') // Replace consecutive dots
    .replace(/\/{2,}/g, '/') // Replace consecutive slashes
    .replace(/^\/|\/$/g, '') // Remove leading/trailing slashes
    .replace(/\.lock$/, '') // Remove .lock suffix
    .replace(/-{2,}/g, '-') // Replace multiple hyphens with single
    .toLowerCase();
}

/**
 * Generate a unique workspace branch name
 */
export function generateWorkspaceBranchName(baseBranch?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const base = baseBranch ? sanitizeBranchName(baseBranch) : 'workspace';
  return `${base}-${timestamp}-${random}`;
}

/**
 * Validate initial prompt
 *
 * Note: We intentionally do NOT check for HTML/JS patterns here because:
 * 1. This content is sent to an AI backend, not rendered as HTML
 * 2. Users legitimately need to discuss code including JavaScript
 * 3. Any HTML rendering happens after server-side processing with proper escaping
 */
export function validateInitialPrompt(prompt: string): ValidationResult {
  if (!prompt || prompt.trim().length === 0) {
    // Empty prompt is valid (optional)
    return { valid: true };
  }

  const trimmed = prompt.trim();

  if (trimmed.length > 100000) {
    return {
      valid: false,
      error: m.workspace_validation_promptTooLong_error(),
      suggestion: m.workspace_validation_promptTooLong_suggestion(),
    };
  }

  return { valid: true };
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
