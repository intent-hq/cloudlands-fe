import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CT_DISMISSIBLE_LAYER_DELAY_MARKER,
  CT_DISMISSIBLE_LAYER_DELAY_MS,
  delayOneMillisecondTimers,
  resolveCtDismissibleLayerDelay,
} from './ct-dismissible-layer-delay';

describe('resolveCtDismissibleLayerDelay', () => {
  it('is off when CT_DELAY_DISMISSIBLE_LAYER is unset, blank or 0', () => {
    expect(resolveCtDismissibleLayerDelay({ env: {} })).toBeUndefined();
    expect(resolveCtDismissibleLayerDelay({ env: { CI: 'true' } })).toBeUndefined();
    for (const raw of ['', ' ', '\n', '0', ' 0 ']) {
      expect(resolveCtDismissibleLayerDelay({ env: { CT_DELAY_DISMISSIBLE_LAYER: raw } })).toBe(
        undefined,
      );
    }
  });

  it.each(['1', ' 1', '1 ', '\t1\n'])('delays to 500 ms for %j', (raw) => {
    expect(resolveCtDismissibleLayerDelay({ env: { CT_DELAY_DISMISSIBLE_LAYER: raw } })).toBe(
      CT_DISMISSIBLE_LAYER_DELAY_MS,
    );
    expect(CT_DISMISSIBLE_LAYER_DELAY_MS).toBe(500);
  });

  it.each(['true', 'yes', 'on', '500', '11', '1.0', 'junk'])(
    'rejects the unsupported value %j instead of silently running undelayed',
    (raw) => {
      expect(() =>
        resolveCtDismissibleLayerDelay({ env: { CT_DELAY_DISMISSIBLE_LAYER: raw } }),
      ).toThrow(
        `CT_DELAY_DISMISSIBLE_LAYER=${JSON.stringify(raw)} is not supported: use 1 to delay`,
      );
    },
  );
});

describe('delayOneMillisecondTimers', () => {
  const scope = globalThis as Record<string, unknown>;
  const realSetTimeout = globalThis.setTimeout;

  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
    delete scope[CT_DISMISSIBLE_LAYER_DELAY_MARKER];
  });

  function install(delayMs: number, source: 'module' | 'serialized' = 'module') {
    const spy = vi.fn(() => 0);
    globalThis.setTimeout = spy as unknown as typeof setTimeout;
    const script =
      source === 'module'
        ? delayOneMillisecondTimers
        : (new Function(`return (${delayOneMillisecondTimers.toString()})`)() as (
            delayMs: number,
          ) => void);
    script(delayMs);
    return spy;
  }

  it.each(['module', 'serialized'] as const)(
    'turns only a 1 ms delay into the configured delay (%s)',
    (source) => {
      const spy = install(500, source);
      const callback = () => undefined;

      setTimeout(callback, 1);
      setTimeout(callback, 2, 'extra');
      setTimeout(callback, 0);
      setTimeout(callback);

      expect(spy.mock.calls).toEqual([
        [callback, 500],
        [callback, 2, 'extra'],
        [callback, 0],
        [callback, undefined],
      ]);
      expect(scope[CT_DISMISSIBLE_LAYER_DELAY_MARKER]).toBe(500);
    },
  );

  it('does not wrap setTimeout twice when the init script runs again', () => {
    const spy = install(500);
    const wrapped = globalThis.setTimeout;
    delayOneMillisecondTimers(900);
    expect(globalThis.setTimeout).toBe(wrapped);
    setTimeout(() => undefined, 1);
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 500);
    expect(scope[CT_DISMISSIBLE_LAYER_DELAY_MARKER]).toBe(500);
  });
});
