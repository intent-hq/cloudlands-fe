import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClientLogger } from './client-logger';

describe('ClientLogger data serialization', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logger: ClientLogger;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger = new ClientLogger('test');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('embeds a plain object payload as compact JSON in the message string', () => {
    const data = { a: 1, b: 'two' };
    logger.warn('msg', data);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message, rawData] = warnSpy.mock.calls[0];
    expect(message).toMatch(/^\[.+\] \[WARN\] \[test\] msg \{"a":1,"b":"two"\}$/);
    // Raw data object is still passed for DevTools inspection.
    expect(rawData).toBe(data);
  });

  it('leaves output unchanged when data is undefined (no trailing space)', () => {
    logger.warn('msg');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toHaveLength(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/^\[.+\] \[WARN\] \[test\] msg$/);
  });

  it('does not throw on circular references and uses a placeholder', () => {
    const data: Record<string, unknown> = { a: 1 };
    data.self = data;

    expect(() => logger.warn('msg', data)).not.toThrow();
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('"a":1');
    expect(message).toContain('[circular]');
  });

  it('serializes Error values in the payload to name and message', () => {
    logger.warn('msg', { err: new TypeError('boom') });

    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('"name":"TypeError"');
    expect(message).toContain('"message":"boom"');
  });

  it('caps oversized payloads with a truncation marker', () => {
    logger.warn('msg', { big: 'x'.repeat(5000) });

    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('… [truncated]');
    // prefix + message + 2000 chars of JSON + marker stays well under the 4096 line cap.
    expect(message.length).toBeLessThan(2200);
  });

  it('stringifies BigInt values instead of throwing', () => {
    expect(() => logger.warn('msg', { n: 123n })).not.toThrow();
    expect(warnSpy.mock.calls[0][0]).toContain('"n":"123"');
  });

  it('falls back to a placeholder when a getter throws', () => {
    const data = {
      get boom(): string {
        throw new Error('nope');
      },
    };

    expect(() => logger.warn('msg', data)).not.toThrow();
    expect(warnSpy.mock.calls[0][0]).toContain('[unserializable]');
  });

  it('includes serialized error details via logger.error', () => {
    logger.error('failed', new Error('kaboom'));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = errorSpy.mock.calls[0][0] as string;
    expect(message).toContain('"message":"kaboom"');
    expect(message).toContain('"name":"Error"');
  });
});
