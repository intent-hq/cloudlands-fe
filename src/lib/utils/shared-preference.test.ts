import { afterEach, describe, expect, it, vi } from 'vitest';

import { onSharedStorageChange, sharedPreference } from './shared-preference';

type Density = 'compact' | 'roomy';

const KEY = 'test:density';

const density = () =>
  sharedPreference<Density>({
    key: KEY,
    scope: 'app',
    format: 'text',
    parse: (stored) => (stored === 'compact' || stored === 'roomy' ? stored : undefined),
  });

/** Another view of the app saved `value` under `key` (`null` removes it). */
function otherViewSaves(key: string, value: string | null): void {
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
}

describe('sharedPreference', () => {
  const stops: Array<() => void> = [];
  const follow = <T>(preference: { subscribe: (listener: (value: T) => void) => () => void }) => {
    const seen: T[] = [];
    stops.push(preference.subscribe((value) => seen.push(value)));
    return seen;
  };

  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });

  it('saves text and JSON values and reads them back', () => {
    const text = density();
    text.write('roomy');
    expect(window.localStorage.getItem(KEY)).toBe('roomy');
    expect(text.read()).toBe('roomy');

    const json = sharedPreference<string[]>({
      key: 'test:list',
      scope: 'host',
      parse: (stored) => (Array.isArray(stored) ? stored.map(String) : undefined),
    });
    json.write(['a', 'b']);
    expect(window.localStorage.getItem('test:list')).toBe('["a","b"]');
    expect(json.read()).toEqual(['a', 'b']);

    json.remove();
    expect(json.read()).toBeUndefined();
  });

  it('reads nothing for a missing or invalid stored value', () => {
    const preference = density();
    expect(preference.read()).toBeUndefined();
    window.localStorage.setItem(KEY, 'huge');
    expect(preference.read()).toBeUndefined();
  });

  it("gives a subscriber another view's change", () => {
    const seen = follow(density());
    otherViewSaves(KEY, 'compact');
    otherViewSaves(KEY, 'roomy');
    expect(seen).toEqual(['compact', 'roomy']);
  });

  it('ignores a change to an unrelated key', () => {
    const read = vi.mocked(window.localStorage.getItem);
    const seen = follow(density());
    read.mockClear();
    otherViewSaves('test:unrelated', 'compact');
    expect(seen).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it('reports no value when the key is removed or storage is cleared', () => {
    window.localStorage.setItem(KEY, 'compact');
    const seen = follow(density());
    otherViewSaves(KEY, null);
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(seen).toEqual([undefined, undefined]);
  });

  it('stops following after unsubscribe and shares one window listener', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const seen: Array<string | null> = [];
    const stopFirst = onSharedStorageChange((key) => seen.push(key));
    const stopSecond = onSharedStorageChange(() => {});
    expect(add.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1);

    stopFirst();
    otherViewSaves(KEY, 'compact');
    expect(seen).toEqual([]);
    expect(remove.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(0);

    stopSecond();
    expect(remove.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
  });

  it('keeps notifying other subscribers when one throws', () => {
    stops.push(
      onSharedStorageChange(() => {
        throw new Error('listener failed');
      }),
    );
    const seen = follow(density());
    otherViewSaves(KEY, 'roomy');
    expect(seen).toEqual(['roomy']);
  });
});
