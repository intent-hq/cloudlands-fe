import type {
  DesktopState,
  DesktopPermissionDecision,
  DesktopPermissionState,
  DesktopPermissionRequest,
  DesktopPermissionResolvedEvent,
  DesktopPermissionChangedEvent,
  DesktopSessionChangedEvent,
} from '$shared/types/desktop';

export type DesktopDecision = DesktopPermissionDecision;
export interface DesktopSnapshot {
  state: DesktopState;
  permission: DesktopPermissionState;
  pending?: DesktopPermissionRequest;
}
export type DesktopEvent =
  | { id: string; type: 'desktop:permission-requested'; data: DesktopPermissionRequest }
  | { id: string; type: 'desktop:permission-resolved'; data: DesktopPermissionResolvedEvent }
  | { id: string; type: 'desktop:permission-changed'; data: DesktopPermissionChangedEvent }
  | { id: string; type: 'desktop:session-changed'; data: DesktopSessionChangedEvent };
type DesktopDisplayState =
  | Exclude<DesktopState, { status: 'active' }>
  | Omit<Extract<DesktopState, { status: 'active' }>, 'hint'>;
export interface DesktopEntry {
  workspaceId: string;
  agentId: string;
  state: DesktopDisplayState;
  permission?: DesktopPermissionState;
  pending?: DesktopPermissionRequest;
  revision: number;
  loading: boolean;
  submitting: boolean;
  settingUp?: boolean;
  saving: boolean;
  error?: string;
  resolvedRequests: string[];
  endedSessions: string[];
}
export interface DesktopControlState {
  generation: number;
  byKey: Record<string, DesktopEntry>;
  seenEvents: string[];
}
export function desktopKey(workspaceId: string, agentId: string): string {
  return JSON.stringify([workspaceId, agentId]);
}
export function emptyDesktopEntry(workspaceId: string, agentId: string): DesktopEntry {
  return {
    workspaceId,
    agentId,
    state: { status: 'inactive' },
    revision: 0,
    loading: false,
    submitting: false,
    saving: false,
    resolvedRequests: [],
    endedSessions: [],
  };
}
