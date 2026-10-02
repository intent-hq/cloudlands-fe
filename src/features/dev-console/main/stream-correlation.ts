/** Protocol adapters for diagnostic correlation only; never change transport delivery. */
export interface StreamHandle {
  family: 'subscription' | 'host-exec' | 'clone' | 'search' | 'provision';
  id: string;
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function handle(family: StreamHandle['family'], id: unknown): StreamHandle | undefined {
  return typeof id === 'string' && id.length > 0 ? { family, id } : undefined;
}
function operationFamily(method: string): StreamHandle['family'] | undefined {
  if (method === 'host.execStream') return 'host-exec';
  if (method === 'git.clone') return 'clone';
  if (
    [
      'search.inFiles',
      'search.fileNames',
      'search.messages',
      'search.events',
      'search.codebase',
    ].includes(method)
  )
    return 'search';
}
export function requestStream(method: string, params: unknown): StreamHandle | undefined {
  const data = object(params);
  if (method === 'workspace.create')
    return handle(
      'provision',
      typeof data.progressId === 'string' ? data.progressId.trim() : undefined,
    );
  const family = operationFamily(method);
  return family ? handle(family, data.requestId) : undefined;
}
export function responseStream(method: string, result: unknown): StreamHandle | undefined {
  const data = object(result);
  // All existing snapshot+delta channels share this ack contract, independent of method.
  const subscription = handle('subscription', data.subscriptionId);
  if (subscription) return subscription;
  const family = operationFamily(method);
  return family ? handle(family, data.requestId) : undefined;
}
export function requestContinuation(method: string, params: unknown): StreamHandle | undefined {
  if (method === 'host.execStream.write' || method === 'host.execStream.cancel')
    return handle('host-exec', object(params).requestId);
  if (method === 'search.cancel') return handle('search', object(params).requestId);
}
export function unsubscribeStream(method: string, params: unknown): StreamHandle | undefined {
  if (method.endsWith('.unsubscribe')) return handle('subscription', object(params).subscriptionId);
}
export function subscriptionGroup(params: unknown): string | undefined {
  const group = object(params).replaceGroup;
  return typeof group === 'string' ? group : undefined;
}
export function unsubscribeSucceeded(result: unknown): boolean {
  return object(result).success === true;
}
export function notificationStreams(
  method: string,
  params: unknown,
): { handle: StreamHandle; terminal: boolean }[] {
  const data = object(params);
  const streams: { handle: StreamHandle; terminal: boolean }[] = [];
  if (method === 'subscription.push' || method === 'events.event') {
    const subscription = handle('subscription', data.subscriptionId);
    if (subscription) streams.push({ handle: subscription, terminal: false });
  }
  // §6.5 event families explicitly carry invocation handles. Entity IDs/turn IDs are
  // not RPC identities: other bus events remain on their events.subscribe stream.
  if (method === 'events.event') {
    const event = object(data.event);
    const payload = object(event.data);
    let family: StreamHandle['family'] | undefined;
    let terminal = false;
    if (
      ['host:exec:stdout', 'host:exec:stderr', 'host:exec:exit'].includes(
        typeof event.type === 'string' ? event.type : '',
      )
    ) {
      family = 'host-exec';
      terminal = event.type === 'host:exec:exit';
    } else if (event.type === 'search:result' || event.type === 'search:done') {
      family = 'search';
      terminal = event.type === 'search:done';
    } else if (event.type === 'git:clone:progress' || event.type === 'git:clone:done') {
      family = 'clone';
      terminal = event.type === 'git:clone:done';
      const provision = handle('provision', payload.progressId);
      if (provision) streams.push({ handle: provision, terminal });
    }
    const operation = family && handle(family, payload.requestId);
    if (operation) streams.push({ handle: operation, terminal });
  }
  return streams;
}
