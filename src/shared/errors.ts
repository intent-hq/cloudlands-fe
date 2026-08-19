/**
 * Structured Error Classes
 *
 * Provides consistent error handling across the application.
 */

/**
 * Base error class for all application errors
 */
class AppError extends Error {
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
class WorkspaceError extends AppError {
  constructor(message: string, code: string, details?: any) {
    super(message, code, details);
  }
}

export class WorkspaceNotFoundError extends WorkspaceError {
  constructor(id: string) {
    super(`Workspace not found: ${id}`, 'WORKSPACE_NOT_FOUND', { workspaceId: id });
  }
}

/**
 * File system errors
 */
class FileSystemError extends AppError {
  constructor(message: string, code: string, details?: any) {
    super(message, code, details);
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
