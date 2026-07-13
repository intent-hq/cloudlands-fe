import { dialog } from 'electron';
import { Logger } from './logger';

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public isOperational: boolean = true,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ErrorHandler {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  handle(error: Error, context?: string): void {
    const errorMessage = context ? `${context}: ${error.message}` : error.message;

    // Log the error
    const logData: any = {
      message: errorMessage,
      name: error.name,
      stack: error.stack,
    };

    if (error instanceof AppError) {
      logData.code = error.code;
      logData.statusCode = error.statusCode;
      logData.isOperational = error.isOperational;
    }

    this.logger.error(errorMessage, logData);

    // Show user-friendly error dialog for operational errors
    if (error instanceof AppError && error.isOperational) {
      this.showErrorDialog(errorMessage);
    } else if (process.env.NODE_ENV === 'development') {
      // Show detailed error in development
      this.showErrorDialog(`${errorMessage}\n\n${error.stack}`);
    } else {
      // Show generic error in production for non-operational errors
      this.showErrorDialog('An unexpected error occurred. Please check the logs for details.');
    }
  }

  private showErrorDialog(message: string): void {
    dialog.showErrorBox('Error', message);
  }

  async handleAsync<T>(fn: () => Promise<T>, context?: string): Promise<T | null> {
    try {
      return await fn();
    } catch (error) {
      this.handle(error as Error, context);
      return null;
    }
  }
}
