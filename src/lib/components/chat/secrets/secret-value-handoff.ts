/**
 * One-shot, in-memory handoff of a secret value from the card to the provide
 * saga (PROTOCOL §5.56). Keeps the value out of Redux actions and state: the
 * card stashes it under the request id, dispatches an id-only action, and the
 * saga takes it exactly once. An untaken value is dropped after a short
 * timeout. Never logged, persisted or serialized.
 */

const HANDOFF_TTL_MS = 30_000;
const slots = new Map<string, { value: string; timer: ReturnType<typeof setTimeout> }>();

export function stashSecretValue(requestId: string, value: string): void {
  const previous = slots.get(requestId);
  if (previous) clearTimeout(previous.timer);
  const timer = setTimeout(() => slots.delete(requestId), HANDOFF_TTL_MS);
  slots.set(requestId, { value, timer });
}

/** Take (and remove) the stashed value; `undefined` when none is waiting. */
export function takeSecretValue(requestId: string): string | undefined {
  const slot = slots.get(requestId);
  if (!slot) return undefined;
  clearTimeout(slot.timer);
  slots.delete(requestId);
  return slot.value;
}
