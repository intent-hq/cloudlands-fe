import type { ConnectionsState } from './connections-types';
/** The real window binding, including its unadmitted boot default. */
export const getCurrentConnectionId = (state: { connections: ConnectionsState }) =>
  state.connections.windowBackendId;
