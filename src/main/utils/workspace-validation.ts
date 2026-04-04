/**
 * Workspace validation utilities
 */

import type {
  Workspace,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
} from '../../shared/types';

export function validateWorkspace(workspace: Partial<Workspace>): string[] {
  const errors: string[] = [];

  // Title is optional - workspaces can be created without a title

  if (!workspace.path) {
    errors.push('Workspace path is required');
  }

  return errors;
}

export function validateWorkspaceId(id: string): string[] {
  const errors: string[] = [];

  if (!id) {
    errors.push('Workspace ID is required');
  }

  if (id && !id.match(/^[a-zA-Z0-9-_]+$/)) {
    errors.push('Workspace ID contains invalid characters');
  }

  return errors;
}

/**
 * Boolean workspace ID validation helper.
 *
 * NOTE: `validateWorkspaceId` returns an array of errors (empty = valid).
 * Several call sites historically treated it as a boolean; use this helper
 * to avoid that footgun.
 */
export function isValidWorkspaceIdFormat(id: string): boolean {
  return validateWorkspaceId(id).length === 0;
}

export function validateWorkspaceTitle(title: string | undefined): string[] {
  const errors: string[] = [];

  // Title is optional - blank titles are allowed

  if (title && title.length > 100) {
    errors.push('Workspace title is too long (max 100 characters)');
  }

  return errors;
}

/**
 * Boolean workspace title validation helper.
 *
 * NOTE: `validateWorkspaceTitle` returns an array of errors (empty = valid).
 * Use this helper to get a simple boolean result.
 */
export function isValidWorkspaceTitle(title: string | undefined): boolean {
  return validateWorkspaceTitle(title).length === 0;
}

/**
 * Validate a git branch name according to git-check-ref-format rules.
 * See: https://git-scm.com/docs/git-check-ref-format
 */
export function validateBranchName(branch: string): string[] {
  const errors: string[] = [];

  if (!branch) {
    errors.push('Branch name is required');
    return errors;
  }

  // Cannot be empty or whitespace only
  if (branch.trim().length === 0) {
    errors.push('Branch name cannot be empty or whitespace only');
    return errors;
  }

  // Cannot contain spaces
  if (branch.includes(' ')) {
    errors.push('Branch name cannot contain spaces');
  }

  // Cannot contain certain special characters: ~ ^ : \ ? * [ @ {
  if (/[~^:\\?*\[@{]/.test(branch)) {
    errors.push('Branch name contains invalid characters (~, ^, :, \\, ?, *, [, @, {)');
  }

  // Cannot start with a dot
  if (branch.startsWith('.')) {
    errors.push("Branch name cannot start with '.'");
  }

  // Cannot end with a dot
  if (branch.endsWith('.')) {
    errors.push("Branch name cannot end with '.'");
  }

  // Cannot end with .lock
  if (branch.endsWith('.lock')) {
    errors.push("Branch name cannot end with '.lock'");
  }

  // Cannot contain consecutive dots
  if (branch.includes('..')) {
    errors.push("Branch name cannot contain '..'");
  }

  // Cannot contain @{
  if (branch.includes('@{')) {
    errors.push("Branch name cannot contain '@{'");
  }

  // Cannot start or end with a slash
  if (branch.startsWith('/') || branch.endsWith('/')) {
    errors.push('Branch name cannot start or end with /');
  }

  // Cannot contain consecutive slashes
  if (branch.includes('//')) {
    errors.push('Branch name cannot contain consecutive slashes');
  }

  // Cannot start with a dash
  if (branch.startsWith('-')) {
    errors.push("Branch name cannot start with '-'");
  }

  // Maximum length (git has a 255 byte limit for ref names)
  if (branch.length > 250) {
    errors.push('Branch name is too long (max 250 characters)');
  }

  // Cannot be a single @ character
  if (branch === '@') {
    errors.push("Branch name cannot be a single '@'");
  }

  return errors;
}

/**
 * Boolean branch name validation helper.
 * Returns true if the branch name is valid, false otherwise.
 */
export function isValidBranchName(branch: string): boolean {
  return validateBranchName(branch).length === 0;
}

/**
 * Get a human-readable validation error message for a branch name.
 * Returns undefined if the branch name is valid.
 */
export function getBranchNameValidationError(branch: string): string | undefined {
  const errors = validateBranchName(branch);
  if (errors.length === 0) {
    return undefined;
  }
  return errors.join('. ');
}

export function validateRepositoryPath(path: string): string[] {
  const errors: string[] = [];

  if (!path) {
    errors.push('Repository path is required');
  }

  // Basic path validation
  if (path && path.includes('..')) {
    errors.push("Repository path cannot contain '..'");
  }

  return errors;
}

export function sanitizePath(inputPath: string): string {
  // Remove any potentially dangerous characters
  return inputPath
    .replace(/\.\./g, '')
    .replace(/[<>:"|?*]/g, '')
    .replace(/\\/g, '/')
    .trim();
}

export function validateCreateRequest(request: CreateWorkspaceRequest): string[] {
  const errors: string[] = [];

  // Title is optional - blank titles are allowed

  // Repository path is required unless a GitHub URL is provided
  // When githubUrl is provided, the repo will be cloned to a local path
  if (!request.repositoryPath && !request.githubUrl) {
    errors.push('Repository path is required (or provide a GitHub URL)');
  }

  return errors;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function validateUpdateRequest(request: UpdateWorkspaceRequest): string[] {
  const errors: string[] = [];

  // Update requests don't require any specific fields
  // Title can be blank (empty string) - this is allowed

  return errors;
}

export function isValidWorkspacePath(path: string): boolean {
  // Basic path validation
  return path.length > 0 && !path.includes('\0');
}
