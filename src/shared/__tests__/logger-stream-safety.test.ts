import { EventEmitter } from 'node:events';
import { inspect } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { isConsoleStreamAvailable, Logger, protectConsoleStream } from '../logger';

class SimulatedConsoleStream extends EventEmitter {
  write = vi.fn();
}

function closedStreamError(code: string): Error & { code: string } {
  return Object.assign(new Error('stream is closed'), { code });
}

describe('logger console stream safety', () => {
  it.each(['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'])(
    'contains a %s event and disables further writes to that stream',
    (code) => {
      const stream = new SimulatedConsoleStream();
      protectConsoleStream(stream);

      expect(() => stream.emit('error', closedStreamError(code))).not.toThrow();
      expect(isConsoleStreamAvailable(stream)).toBe(false);
      expect(stream.listenerCount('error')).toBe(1);
    },
  );

  it('propagates EIO and disables only the failed stream', () => {
    const failedStream = new SimulatedConsoleStream();
    const availableStream = new SimulatedConsoleStream();
    const error = closedStreamError('EIO');
    protectConsoleStream(failedStream);
    protectConsoleStream(availableStream);

    expect(() => failedStream.emit('error', error)).toThrow(error);
    expect(isConsoleStreamAvailable(failedStream)).toBe(false);
    expect(isConsoleStreamAvailable(availableStream)).toBe(true);
  });

  it('keeps a healthy stream available when console inspection throws', () => {
    const inspectionError = new Error('custom inspection failed');
    const inspectedError = new Error('inspect me') as Error & {
      [inspect.custom]?: () => never;
    };
    inspectedError[inspect.custom] = () => {
      throw inspectionError;
    };
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementationOnce((...args) => {
        inspect(args.at(-1));
      })
      .mockImplementation(() => undefined);
    const logger = new Logger('App');

    expect(() => logger.error('formatting failure', inspectedError)).toThrow(inspectionError);
    expect(isConsoleStreamAvailable(process.stderr)).toBe(true);
    expect(() => logger.error('next failure')).not.toThrow();
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it('stops error logging after a synchronous stderr EPIPE', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementationOnce(() => {
        throw closedStreamError('EPIPE');
      })
      .mockImplementation(() => undefined);
    const logger = new Logger('App');

    expect(() => logger.error('first failure')).not.toThrow();
    logger.error('second failure');

    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('applies the same synchronous containment to stdout', () => {
    const consoleLog = vi
      .spyOn(console, 'log')
      .mockImplementationOnce(() => {
        throw closedStreamError('EPIPE');
      })
      .mockImplementation(() => undefined);
    const logger = new Logger('App');

    expect(() => logger.info('first message')).not.toThrow();
    logger.info('second message');

    expect(consoleLog).toHaveBeenCalledTimes(1);
  });
});
