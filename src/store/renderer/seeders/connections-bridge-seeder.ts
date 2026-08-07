/**
 * Connections IPC bridge — mock fallback for the multi-backend connect channels.
 *
 * Bridges the `connections:*` request/response channels (`list`,
 * `capture-fingerprint`, `add`, `forget`, `switch`) so the connections service
 * thunks resolve in bridge-less builds (browser mock) and tests instead of
 * rejecting with UnbridgedMockIpcChannelError.
 *
 * In production (live electronAPI) these are handled by the main-process
 * connections IPC (T3), which owns the encrypted token store and broadcasts
 * `connections:changed` after every mutation. This seeder keeps a coherent
 * in-memory list within a session but does NOT broadcast the push (the mock
 * router has no main process to originate it) — callers re-`list` to refresh.
 *
 * Handlers are registered at import time (host-bridge-seeder idiom). Tests
 * override individual channels via `registerMockIpcHandler` after this runs.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { CONNECTION_CHANNELS, LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type {
  ConnectionRecord,
  ConnectionsListResult,
  CaptureFingerprintParams,
  CaptureFingerprintResult,
  AddConnectionParams,
  AddConnectionResult,
  ForgetConnectionParams,
  ForgetConnectionResult,
  SwitchConnectionParams,
  SwitchConnectionResult,
} from '$shared/types/connections';

/** The always-present, non-forgettable local sidecar entry. */
const LOCAL_ENTRY: ConnectionRecord = {
  id: LOCAL_CONNECTION_ID,
  label: 'This machine (local)',
  host: null,
  port: null,
  fingerprint: null,
  isLocal: true,
};

// Session-scoped in-memory store so add/forget/switch stay coherent with list.
let connections: ConnectionRecord[] = [LOCAL_ENTRY];
let activeId: string = LOCAL_CONNECTION_ID;

registerMockIpcHandler(CONNECTION_CHANNELS.LIST, async (): Promise<ConnectionsListResult> => {
  return { connections: [...connections], activeId };
});

registerMockIpcHandler(
  CONNECTION_CHANNELS.CAPTURE_FINGERPRINT,
  async (arg): Promise<CaptureFingerprintResult> => {
    const { host, port } = arg as CaptureFingerprintParams;
    // Deterministic stub fingerprint (colon-hex uppercase, PROTOCOL §1.2 shape).
    const seed = `${host}:${port}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) & 0xffff;
    const byte = (hash & 0xff).toString(16).padStart(2, '0').toUpperCase();
    return { fingerprint: Array.from({ length: 32 }, () => byte).join(':') };
  },
);

registerMockIpcHandler(CONNECTION_CHANNELS.ADD, async (arg): Promise<AddConnectionResult> => {
  const params = arg as AddConnectionParams;
  // Token is consumed here (encrypted at rest by main in production) and never
  // returned on the record.
  const connection: ConnectionRecord = {
    id: `mock-${params.host}:${params.port}`,
    label: params.label,
    host: params.host,
    port: params.port,
    fingerprint: params.fingerprint,
    isLocal: false,
  };
  connections = [...connections.filter((c) => c.id !== connection.id), connection];
  return { connection };
});

registerMockIpcHandler(CONNECTION_CHANNELS.FORGET, async (arg): Promise<ForgetConnectionResult> => {
  const { id } = arg as ForgetConnectionParams;
  connections = connections.filter((c) => c.id !== id || c.isLocal);
  if (activeId === id) activeId = LOCAL_CONNECTION_ID;
  return { id };
});

registerMockIpcHandler(CONNECTION_CHANNELS.SWITCH, async (arg): Promise<SwitchConnectionResult> => {
  const { id } = arg as SwitchConnectionParams;
  if (connections.some((c) => c.id === id)) activeId = id;
  return { activeId };
});
