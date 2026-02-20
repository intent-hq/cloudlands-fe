/**
 * Structured Error Classes
 *
 * Provides consistent error handling across the application.
 */

/**
 * Base error class for all application errors
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
    };
  }
}

/**
 * Workspace errors
 */
export class WorkspaceError extends AppError {
  constructor(message: string, code: string, details?: any) {
    super(message, code, details);
  }
}

export class WorkspaceNotFoundError extends WorkspaceError {
  constructor(id: string) {
    super(`Workspace not found: ${id}`, 'WORKSPACE_NOT_FOUND', { workspaceId: id });
  }
}

export class WorkspaceValidationError extends WorkspaceError {
  constructor(errors: string[]) {
    super('Space validation failed', 'WORKSPACE_VALIDATION_ERROR', { errors });
  }
}

export class WorkspaceAlreadyExistsError extends WorkspaceError {
  constructor(id: string) {
    super(`Space already exists: ${id}`, 'WORKSPACE_ALREADY_EXISTS', { workspaceId: id });
  }
}

/**
 * Note errors
 */
export class NoteError extends AppError {
  constructor(message: string, code: string, details?: any) {
    super(message, code, details);
  }
}

export class NoteNotFoundError extends NoteError {
  constructor(workspaceId: string, noteId: string) {
    super(`Note not found: ${noteId} in space ${workspaceId}`, 'NOTE_NOT_FOUND', {
      workspaceId,
      noteId,
    });
  }
}

export class NoteValidationError extends NoteError {
  constructor(errors: string[]) {
    super('Note validation failed', 'NOTE_VALIDATION_ERROR', { errors });
  }
}

/**
 * Comment errors
 */
export class CommentError extends AppError {
  constructor(message: string, code: string, details?: any) {
    super(message, code, details);
  }
}

export class CommentNotFoundError extends CommentError {
  constructor(workspaceId: string, noteId: string, commentId: string) {
    super(`Comment not found: ${commentId} in note ${noteId}`, 'COMMENT_NOT_FOUND', {
      workspaceId,
      noteId,
      commentId,
    });
  }
}

export class CommentValidationError extends CommentError {
  constructor(errors: string[]) {
    super('Comment validation failed', 'COMMENT_VALIDATION_ERROR', { errors });
  }
}

/**
 * File system errors
 */
export class FileSystemError extends AppError {
  constructor(message: string, code: string, details?: any) {
    super(message, code, details);
  }
}

export class FileNotFoundError extends FileSystemError {
  constructor(path: string) {
    super(`File not found: ${path}`, 'FILE_NOT_FOUND', { path });
  }
}

export class FileReadError extends FileSystemError {
  constructor(path: string, originalError: Error) {
    super(`Failed to read file ${path}: ${originalError.message}`, 'FILE_READ_ERROR', {
      path,
      originalError: originalError.message,
    });
  }
}

export class FileWriteError extends FileSystemError {
  constructor(path: string, originalError: Error) {
    super(`Failed to write file ${path}: ${originalError.message}`, 'FILE_WRITE_ERROR', {
      path,
      originalError: originalError.message,
    });
  }
}

/**
 * Validation errors
 */
export class ValidationError extends AppError {
  constructor(message: string, errors: string[]) {
    super(message, 'VALIDATION_ERROR', { errors });
  }
}

/**
 * Git errors
 */
export class GitError extends AppError {
  constructor(message: string, code: string, details?: any) {
    super(message, code, details);
  }
}

export class GitWorktreeError extends GitError {
  constructor(message: string, details?: any) {
    super(message, 'GIT_WORKTREE_ERROR', details);
  }
}

/**
 * Permission errors
 */
export class PermissionError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 'PERMISSION_ERROR', details);
  }
}

/**
 * Path security errors
 */
export class PathSecurityError extends AppError {
  constructor(path: string, reason: string) {
    super(`Path security violation: ${reason}`, 'PATH_SECURITY_ERROR', { path, reason });
  }
}

/**
 * Helper to check if error is an AppError
 */
export function isAppError(error: any): error is AppError {
  return error instanceof AppError;
}

/**
 * Helper to convert any error to AppError
 */
export function toAppError(error: any): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(error.message, 'UNKNOWN_ERROR', { originalError: error.name });
  }

  return new AppError(String(error), 'UNKNOWN_ERROR', { originalError: error });
}
