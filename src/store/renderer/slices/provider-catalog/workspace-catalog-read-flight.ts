import {
  rendererEventRecovery,
  type RendererRecoveryScope,
} from '$features/events/renderer-event-recovery';

interface ReadSource {
  scope?: RendererRecoveryScope;
  pending: Map<string, Promise<unknown>>;
}
let source: ReadSource = { pending: new Map() };
let initialized = false;

/** Share physical reads across catalog and MCP mirror writers, not across sessions. */
export function trackWorkspaceCatalogRead<T>(
  workspaceId: string,
  read: () => Promise<T>,
): Promise<T> {
  if (!initialized) {
    initialized = true;
    rendererEventRecovery.onSession((scope) => {
      const captured: ReadSource = { scope, pending: new Map() };
      source = captured;
      return () => {
        if (source.scope === scope) source = { pending: new Map() };
      };
    });
  }
  const captured = source;
  const assertCurrent = () => {
    if (source !== captured || (captured.scope && !captured.scope.isCurrent()))
      throw new Error('Workspace catalog read session retired');
  };
  const previous = captured.pending.get(workspaceId);
  const pending = Promise.resolve(previous)
    .catch(() => undefined)
    .then(async () => {
      assertCurrent();
      const result = await read();
      assertCurrent();
      return result;
    });
  captured.pending.set(workspaceId, pending);
  const release = () => {
    if (captured.pending.get(workspaceId) === pending) captured.pending.delete(workspaceId);
  };
  void pending.then(release, release);
  return pending;
}

/** A transport or principal change retires reads even without a recovery attachment. */
export function retireWorkspaceCatalogReads(): void {
  source = { scope: source.scope, pending: new Map() };
}
