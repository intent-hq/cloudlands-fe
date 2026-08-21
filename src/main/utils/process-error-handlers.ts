import { containConsoleStreamError, type Logger } from '../../shared/logger';

type ErrorLogger = Pick<Logger, 'error'>;

function isWebviewNavigationAbort(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('GUEST_VIEW_MANAGER_CALL') && message.includes('ERR_ABORTED');
}

export function handleUncaughtException(logger: ErrorLogger, error: Error): void {
  if (containConsoleStreamError(error) || isWebviewNavigationAbort(error)) return;
  logger.error('Uncaught Exception', error);
}

export function handleUnhandledRejection(
  logger: ErrorLogger,
  reason: unknown,
  promise: Promise<unknown>,
): void {
  if (containConsoleStreamError(reason) || isWebviewNavigationAbort(reason)) return;
  logger.error('Unhandled Rejection', reason as Error, { promise });
}
