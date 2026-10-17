import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import type {
  RendererRecoveryOwner,
  RendererRecoveryScope,
} from '$features/events/renderer-event-recovery';

type Reader = Parameters<RendererRecoveryOwner<unknown[]>['read']>[0];
export interface TypedCollectionRecovery {
  eventTypes: readonly string[];
  read(reader: Reader, params: Record<string, unknown>): Promise<unknown[]>;
}
interface Consumer {
  apply(rows: unknown[]): void;
  retire(): void;
  resume(request: RendererRecoveryScope['request']): void;
}
interface SharedOwner {
  consumers: Set<Consumer>;
  off(): void;
  request?: RendererRecoveryScope['request'];
}
// Multiple views of one typed collection share the same authoritative read owner.
const owners = new Map<string, SharedOwner>();

export function ownTypedCollectionRecovery(
  method: string,
  params: Record<string, unknown>,
  descriptor: TypedCollectionRecovery,
  consumer: Consumer,
) {
  const key = `typed:${JSON.stringify([method, Object.entries(params).sort(([a], [b]) => a.localeCompare(b))])}`;
  let shared = owners.get(key);
  if (!shared) {
    shared = { consumers: new Set(), off: () => {} };
    owners.set(key, shared);
    const owned = shared;
    owned.consumers.add(consumer);
    owned.off = rendererEventRecovery.onSession((scope) => {
      owned.request = scope.request;
      const handle = scope.registerResource({
        key,
        workspaceId: typeof params.workspaceId === 'string' ? params.workspaceId : null,
        eventTypes: descriptor.eventTypes,
        isCurrent: () => owned.consumers.size > 0,
        read: (reader) => descriptor.read(reader, params),
        apply: (rows) => {
          for (const subscriber of owned.consumers) subscriber.apply(rows);
        },
        invalidate: () => {},
        retire: () => {
          for (const subscriber of owned.consumers) subscriber.retire();
        },
      });
      for (const subscriber of owned.consumers) subscriber.resume(scope.request);
      return () => handle.dispose();
    });
  } else {
    shared.consumers.add(consumer);
    if (shared.request) consumer.resume(shared.request);
  }
  const owned = shared;
  return {
    push: () => rendererEventRecovery.push(key),
    dispose: () => {
      owned.consumers.delete(consumer);
      if (owned.consumers.size === 0) {
        owned.off();
        if (owners.get(key) === owned) owners.delete(key);
      }
    },
  };
}
