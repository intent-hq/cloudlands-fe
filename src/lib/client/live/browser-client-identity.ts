import { safeLocalStorage } from '$lib/utils/safe-storage';

/** Browser counterpart of the desktop transport's context-scoped client identity.
 * Only hello identity is persisted here, never draft content or authority.
 * A keyed endpoint digest keeps tokens and credential-bearing URLs out of storage.
 */
export interface BrowserClientIdentity {
  read(): Promise<string | undefined>;
  accepted(clientId: string): Promise<void>;
}
const prefix = 'intent.browserClientIdentity.v1';
export function createBrowserClientIdentity(
  url: string,
  storage: () => Pick<Storage, 'getItem' | 'setItem'> = () => safeLocalStorage,
  crypto: Crypto = globalThis.crypto,
): BrowserClientIdentity {
  const key = (async () => {
    try {
      const prefs = storage();
      let seed = prefs.getItem(`${prefix}.key`);
      if (!seed || !/^[a-f0-9]{64}$/.test(seed)) {
        seed = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
        prefs.setItem(`${prefix}.key`, seed);
      }
      const hmac = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(seed),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const digest = await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(url));
      return `${prefix}.${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    } catch {
      return undefined;
    }
  })();
  return {
    async read() {
      const context = await key;
      if (!context) return undefined;
      try {
        const value = storage().getItem(context);
        return value && value.length <= 512 && !/[\x00-\x20]/.test(value) ? value : undefined;
      } catch {
        return undefined;
      }
    },
    async accepted(clientId) {
      const context = await key;
      if (!context || !clientId || clientId.length > 512 || /[\x00-\x20]/.test(clientId)) return;
      try {
        storage().setItem(context, clientId);
      } catch {
        /* Session identity still survives reconnect. */
      }
    },
  };
}
