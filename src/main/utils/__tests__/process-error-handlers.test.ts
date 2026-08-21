import { describe, expect, it, vi } from 'vitest';

import { handleUncaughtException, handleUnhandledRejection } from '../process-error-handlers';

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error('stream write failed'), { code });
}

describe('main-process error handlers', () => {
  it('logs an unrelated EPIPE uncaught exception', () => {
    const logger = { error: vi.fn() };
    const error = codedError('EPIPE');

    handleUncaughtException(logger, error);

    expect(logger.error).toHaveBeenCalledWith('Uncaught Exception', error);
  });

  it('logs an unrelated stream-destroyed rejection', () => {
    const logger = { error: vi.fn() };
    const reason = codedError('ERR_STREAM_DESTROYED');
    const promise = Promise.resolve();

    handleUnhandledRejection(logger, reason, promise);

    expect(logger.error).toHaveBeenCalledWith('Unhandled Rejection', reason, { promise });
  });

  it('logs other uncaught exceptions normally', () => {
    const logger = { error: vi.fn() };
    const error = new Error('unexpected failure');

    handleUncaughtException(logger, error);

    expect(logger.error).toHaveBeenCalledWith('Uncaught Exception', error);
  });

  it('logs other unhandled rejections normally', () => {
    const logger = { error: vi.fn() };
    const reason = new Error('rejected');
    const promise = Promise.resolve();

    handleUnhandledRejection(logger, reason, promise);

    expect(logger.error).toHaveBeenCalledWith('Unhandled Rejection', reason, { promise });
  });
});
