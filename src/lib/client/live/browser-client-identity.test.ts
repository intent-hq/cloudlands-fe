import { expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createBrowserClientIdentity } from './browser-client-identity';
const crypto = webcrypto as unknown as Crypto;
function prefs() {
  const values = new Map<string, string>();
  return {
    values,
    storage: () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    }),
  };
}
it('restores only accepted canonical identity for the same endpoint and credential context', async () => {
  const { values, storage } = prefs();
  const url = 'wss://example.test/rpc?token=secret';
  const first = createBrowserClientIdentity(url, storage, crypto);
  expect(await first.read()).toBeUndefined();
  await first.accepted('canonical-owner-id');
  expect(await createBrowserClientIdentity(url, storage, crypto).read()).toBe('canonical-owner-id');
  expect(await createBrowserClientIdentity(url + '2', storage, crypto).read()).toBeUndefined();
  expect(
    await createBrowserClientIdentity(
      'wss://another.test/rpc?token=secret',
      storage,
      crypto,
    ).read(),
  ).toBeUndefined();
  expect(JSON.stringify([...values])).not.toContain('secret');
  expect(JSON.stringify([...values])).not.toContain('example.test');
});
it('keeps unavailable storage as session-only identity, without throwing or persisting malformed ids', async () => {
  const unavailable = createBrowserClientIdentity(
    'ws://localhost/',
    () => {
      throw new Error('denied');
    },
    crypto,
  );
  expect(await unavailable.read()).toBeUndefined();
  await unavailable.accepted('valid');
  const { storage } = prefs();
  const identity = createBrowserClientIdentity('ws://localhost/', storage, crypto);
  await identity.accepted('bad\nid');
  expect(await identity.read()).toBeUndefined();
});
