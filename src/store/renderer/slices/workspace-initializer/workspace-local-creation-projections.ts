import {
  getCanAdministerHost,
  getHostAdministrationContext,
  getPrincipalSnapshot,
  getPrincipalActionContext,
  getWorkspaceCreationVisible,
  type PrincipalProjectionState,
} from '../principal/principal-projections';
import type { WorkspaceInitializerState } from './workspace-initializer-types';
type State = PrincipalProjectionState & { workspaceInitializer: WorkspaceInitializerState };
/** Host-only path creation; the key correlates recovery, never authorizes a request. */
export function getWorkspaceLocalCreationAuthority(state: State) {
  const snapshot = getPrincipalSnapshot(state);
  return snapshot && getCanAdministerHost(state) && getWorkspaceCreationVisible(state)
    ? JSON.stringify([state.connections.windowBackendId, snapshot.principal.id])
    : null;
}
export function getWorkspaceLocalCreationReady(state: State) {
  const context = getHostAdministrationContext(state);
  return !!context && state.workspaceInitializer.localReceiptContext === context;
}
export function getWorkspaceLocalCreationLease(state: State) {
  const authority = getWorkspaceLocalCreationAuthority(state);
  const context = getPrincipalActionContext(state);
  const consumer = state.workspaceInitializer.localConsumer;
  return getWorkspaceLocalCreationReady(state) &&
    authority &&
    context &&
    consumer?.context === context
    ? JSON.stringify([authority, context, consumer.id])
    : null;
}
export function getWorkspaceLocalCreation(state: State) {
  const intent = state.workspaceInitializer.localCreation;
  return intent?.authority === getWorkspaceLocalCreationAuthority(state) ? intent : null;
}
