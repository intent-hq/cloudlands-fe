import { getRendererStore, type RendererStoreBridge } from '$store/renderer/renderer-store-bridge';
import { getPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-context';
import { resolveBackendTransport } from './backend-transport-factory';
import { BackendError } from './backend-transport-types';

export interface WorkspaceReadContext {
  key: string;
  isCurrent: () => boolean;
  assertCurrent: () => void;
}

function rendererStore(): RendererStoreBridge | null {
  try {
    return getRendererStore();
  } catch {
    return null;
  }
}

function readKey(store: RendererStoreBridge | null): string {
  if (!store) return 'unbound';
  const { connections, daemonHealth, workspaceEvents, principal } = store.state;
  return JSON.stringify([
    getPrincipalConnectionContext(store.state),
    connections.windowBackendId,
    daemonHealth.connectionGeneration,
    workspaceEvents.subscriptionGeneration,
    workspaceEvents.subscriptionPending,
    principal.context,
    principal.status,
    principal.boundPrincipalId,
    principal.snapshot?.principal.id,
    principal.snapshot?.principal.hostMembershipRevision,
    principal.snapshot?.principal.hostRole,
    principal.snapshot?.principal.isAdministrator,
    principal.minimumRevision,
    principal.invalidation,
    principal.presentationVersion,
  ]);
}

/** Caller-relative workspace reads belong to one store, transport and admission. */
export function captureWorkspaceReadContext(): WorkspaceReadContext {
  const store = rendererStore();
  const dispatch = store?.dispatch;
  const transport = resolveBackendTransport();
  const key = readKey(store);
  const isCurrent = () =>
    rendererStore() === store &&
    store?.dispatch === dispatch &&
    resolveBackendTransport() === transport &&
    readKey(store) === key;
  return {
    key,
    isCurrent,
    assertCurrent: () => {
      if (!isCurrent())
        throw new BackendError({
          code: 'WORKSPACE_READ_RETIRED',
          message: 'WORKSPACE_READ_RETIRED',
        });
    },
  };
}
