/**
 * Generate an idempotency key for create/commit/merge mutations (§5.6): a UUID
 * when the platform exposes `crypto.randomUUID`, otherwise a best-effort unique
 * string. The server dedupes retried requests by this key.
 */
export function newIdempotencyKey(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoObj?.randomUUID === 'function') return cryptoObj.randomUUID();
  return `idk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
