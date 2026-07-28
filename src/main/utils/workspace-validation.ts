/**
 * Workspace validation utilities
 */

import { m } from '../../shared/paraglide/messages.js';
import type { Workspace, CreateWorkspaceRequest, UpdateWorkspaceRequest } from '../../shared/types';

export function validateWorkspace(workspace: Partial<Workspace>): string[] {
  const errors: string[] = [];

  // Title is optional - workspaces can be created without a title

  if (!workspace.path) {
    errors.push(m.workspaceValidation_pathRequired_error());
  }

  return errors;
}

export function validateWorkspaceId(id: string): string[] {
  const errors: string[] = [];

  if (!id) {
    errors.push(m.workspaceValidation_idRequired_error());
  }

  if (id && !id.match(/^[a-zA-Z0-9-_]+$/)) {
    errors.push(m.workspaceValidation_idInvalidChars_error());
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
    errors.push(m.workspaceValidation_titleTooLong_error());
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
    errors.push(m.workspaceValidation_branchRequired_error());
    return errors;
  }

  // Cannot be empty or whitespace only
  if (branch.trim().length === 0) {
    errors.push(m.workspaceValidation_branchEmpty_error());
    return errors;
  }

  // Cannot contain spaces
  if (branch.includes(' ')) {
    errors.push(m.workspaceValidation_branchSpaces_error());
  }

  // Cannot contain certain special characters: ~ ^ : \ ? * [ @ {
  if (/[~^:\\?*\[@{]/.test(branch)) {
    errors.push(
      m.workspaceValidation_branchInvalidChars_error({ chars: '~, ^, :, \\, ?, *, [, @, {' }),
    );
  }

  // Cannot start with a dot
  if (branch.startsWith('.')) {
    errors.push(m.workspaceValidation_branchStartsDot_error());
  }

  // Cannot end with a dot
  if (branch.endsWith('.')) {
    errors.push(m.workspaceValidation_branchEndsDot_error());
  }

  // Cannot end with .lock
  if (branch.endsWith('.lock')) {
    errors.push(m.workspaceValidation_branchEndsLock_error());
  }

  // Cannot contain consecutive dots
  if (branch.includes('..')) {
    errors.push(m.workspaceValidation_branchCannotContain_error({ seq: '..' }));
  }

  // Cannot contain @{
  if (branch.includes('@{')) {
    errors.push(m.workspaceValidation_branchCannotContain_error({ seq: '@{' }));
  }

  // Cannot start or end with a slash
  if (branch.startsWith('/') || branch.endsWith('/')) {
    errors.push(m.workspaceValidation_branchSlashEdges_error());
  }

  // Cannot contain consecutive slashes
  if (branch.includes('//')) {
    errors.push(m.workspaceValidation_branchConsecutiveSlashes_error());
  }

  // Cannot start with a dash
  if (branch.startsWith('-')) {
    errors.push(m.workspaceValidation_branchStartsDash_error());
  }

  // Maximum length (git has a 255 byte limit for ref names)
  if (branch.length > 250) {
    errors.push(m.workspaceValidation_branchTooLong_error());
  }

  // Cannot be a single @ character
  if (branch === '@') {
    errors.push(m.workspaceValidation_branchSingleAt_error());
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
    errors.push(m.workspaceValidation_repoPathRequired_error());
  }

  // Basic path validation
  if (path && path.includes('..')) {
    errors.push(m.workspaceValidation_repoPathDoubleDot_error());
  }

  if (path && path.includes('\0')) {
    errors.push(m.workspaceValidation_repoPathNullChars_error());
  }

  return errors;
}

/**
 * Validate a project/folder name used to construct a new-repo path.
 * Rejects path separators, traversal patterns, null bytes, and OS-unsafe characters
 * so that `join(parentDir, projectName)` cannot escape the parent.
 *
 * Returns an array of error strings (empty = valid).
 */
export function validateProjectName(name: string): string[] {
  const errors: string[] = [];

  if (!name || name.trim().length === 0) {
    errors.push(m.workspaceValidation_projectNameRequired_error());
    return errors;
  }

  const trimmed = name.trim();

  // Reject path separators — the name must be a single directory component
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    errors.push(m.workspaceValidation_projectNameSeparators_error());
  }

  // Reject directory traversal
  if (trimmed === '..' || trimmed === '.') {
    errors.push(m.workspaceValidation_projectNameDots_error());
  }

  // Reject null bytes
  if (trimmed.includes('\0')) {
    errors.push(m.workspaceValidation_projectNameNullChars_error());
  }

  // Reject characters that are invalid on common file systems (Windows + macOS + Linux)
  // < > : " | ? *  are invalid on Windows; \0 already checked above
  if (/[<>:"|?*]/.test(trimmed)) {
    errors.push(m.workspaceValidation_projectNameInvalidChars_error());
  }

  // Reject names that are only dots (e.g. "...", "....")
  if (/^\.+$/.test(trimmed)) {
    errors.push(m.workspaceValidation_projectNameOnlyDots_error());
  }

  // Length limit
  if (trimmed.length > 255) {
    errors.push(m.workspaceValidation_projectNameTooLong_error());
  }

  return errors;
}

/**
 * Boolean helper for validateProjectName.
 * Returns true when the name is safe to use as a single path component.
 */
export function isValidProjectName(name: string): boolean {
  return validateProjectName(name).length === 0;
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
    errors.push(m.workspaceValidation_repoPathOrUrlRequired_error());
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
