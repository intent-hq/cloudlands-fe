/**
 * Resolve the event `type` from an `events.event` notification's params. The
 * daemon wraps each domain event as `{ event: { type, … }, subscriptionId? }`
 * (mirrors extractEvent in features/events/daemon-events-bridge.ts); legacy /
 * flat payloads place `type` directly on params. Returns `undefined` only when
 * the type is genuinely absent AFTER unwrapping, so the family/type matchers'
 * defensive-match branch still fires for truly typeless payloads but not for
 * properly wrapped events of an unrelated family.
 */
export function resolveEventType(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const wrapped = (params as { event?: unknown }).event;
  if (wrapped && typeof wrapped === 'object') {
    const wrappedType = (wrapped as { type?: unknown }).type;
    if (typeof wrappedType === 'string') return wrappedType;
  }
  const flat = (params as { type?: unknown }).type;
  return typeof flat === 'string' ? flat : undefined;
}

/** Whether a daemon notification belongs to the given colon-delimited event family. */
export function isEventInFamily(method: string, params: unknown, family: string): boolean {
  if (method !== 'events.event') return false;
  const type = resolveEventType(params);
  // Refetch on any event whose type starts with the family; if the type is
  // absent (older daemons) refetch defensively.
  return type === undefined || type.startsWith(family);
}

/** Whether a daemon notification's event type is one of the listed types. */
export function isEventOneOf(method: string, params: unknown, types: readonly string[]): boolean {
  if (method !== 'events.event') return false;
  const type = resolveEventType(params);
  if (type === undefined) return true;
  return types.includes(type);
}
