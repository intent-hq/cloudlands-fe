/**
 * Assistant workspace cards on another machine (main process).
 *
 * The Assistant names a workspace on another backend with the `ws.rpc`
 * backend id (the Keychain machine identity). This app maps that id to its own
 * saved connection, the same way it serves `backends.relayCall`, then reads the
 * workspaces over that connection or opens one in the window that asked.
 */
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type {
  OpenBackendWorkspaceParams,
  OpenBackendWorkspaceResult,
  OpenConnectionResult,
  WorkspaceCardsParams,
  WorkspaceCardsResult,
} from '$shared/types/connections';
import { connectionForBackend, type RelayDeps } from './assistant-backend-relay';
import { JsonRpcError } from './json-rpc-errors';

const WORKSPACE_READ_TIMEOUT_MS = 10_000;

export interface WorkspaceCardsDeps extends RelayDeps {
  /** Whether this app already holds a client for the connection. */
  hasClient(connectionId: string): boolean;
  /** Close a client that only this read opened. */
  release(connectionId: string): void;
}

export interface OpenBackendWorkspaceDeps {
  relay: RelayDeps;
  open(connectionId: string, workspaceId: string): Promise<OpenConnectionResult>;
}

async function machineNameFor(connectionId: string, deps: RelayDeps): Promise<string> {
  if (connectionId === LOCAL_CONNECTION_ID) return deps.localFacts()?.name ?? '';
  const record = (await deps.list()).find((entry) => entry.id === connectionId);
  return record?.label ?? record?.host ?? '';
}

function workspaceRow(result: unknown): Record<string, unknown> | null {
  const raw =
    result && typeof result === 'object' && 'workspace' in result
      ? (result as { workspace?: unknown }).workspace
      : result;
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

/**
 * Read the named workspaces from the machine. A workspace the daemon reports
 * missing is left out; a transport failure makes the whole machine unreachable.
 */
export async function readBackendWorkspaceCards(
  params: WorkspaceCardsParams,
  deps: WorkspaceCardsDeps,
): Promise<WorkspaceCardsResult> {
  const connectionId = await connectionForBackend(params.backendId, deps);
  if (!connectionId) return { status: 'unknown-backend' };
  const machineName = await machineNameFor(connectionId, deps);
  // A card must not leave a client reconnecting to a machine nothing else uses.
  const opened = connectionId !== LOCAL_CONNECTION_ID && !deps.hasClient(connectionId);
  const unreachable = (): WorkspaceCardsResult => {
    if (opened) deps.release(connectionId);
    return { status: 'unreachable', machineName };
  };
  let client;
  try {
    client = await deps.clientFor(connectionId);
  } catch {
    return unreachable();
  }
  const ids = [...new Set(params.workspaceIds)];
  const reads = await Promise.allSettled(
    ids.map((workspaceId) =>
      client.request('workspace.get', { workspaceId }, { timeoutMs: WORKSPACE_READ_TIMEOUT_MS }),
    ),
  );
  if (reads.some((read) => read.status === 'rejected' && !(read.reason instanceof JsonRpcError))) {
    return unreachable();
  }
  const workspaces = reads
    .map((read) => (read.status === 'fulfilled' ? workspaceRow(read.value) : null))
    .filter((row): row is Record<string, unknown> => row !== null);
  return { status: 'ok', machineName, workspaces };
}

/** Open the workspace on its machine: in the asking window's rail when it can, else its own window. */
export async function openBackendWorkspace(
  params: OpenBackendWorkspaceParams,
  deps: OpenBackendWorkspaceDeps,
): Promise<OpenBackendWorkspaceResult> {
  const connectionId = await connectionForBackend(params.backendId, deps.relay);
  if (!connectionId) return { status: 'unknown-backend' };
  return deps.open(connectionId, params.workspaceId);
}
