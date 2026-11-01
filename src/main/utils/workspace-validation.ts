/**
 * Workspace validation utilities
 */

import { m } from '../../shared/paraglide/messages.js';
import type { UpdateWorkspaceRequest } from '../../shared/types';

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function validateUpdateRequest(request: UpdateWorkspaceRequest): string[] {
  const errors: string[] = [];

  // Update requests don't require any specific fields
  // Title can be blank (empty string) - this is allowed

  return errors;
}
