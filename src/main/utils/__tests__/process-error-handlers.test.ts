import { describe, expect, it, vi } from 'vitest';

import { handleUncaughtException, handleUnhandledRejection } from '../process-error-handlers';

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error('stream write failed'), { code });
}

describe('main-process error handlers', () => {
  it('contains stderr EPIPE without logging to the failed stream', () => {
    const logger = { error: vi.fn() };

    handleUncaughtException(logger, codedError('EPIPE'));

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('applies the same containment to a closed stdout rejection', () => {
    const logger = { error: vi.fn() };

    handleUnhandledRejection(logger, codedError('ERR_STREAM_DESTROYED'), Promise.resolve());

    expect(logger.error).not.toHaveBeenCalled();
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
