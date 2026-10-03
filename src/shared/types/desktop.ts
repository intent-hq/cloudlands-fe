/** Desktop-control wire contract. Credentials exist only in Electron main. */
export type DesktopState =
  | { status: 'inactive' }
  | { status: 'pending_permission'; requestId: string; computerName?: string }
  | { status: 'active'; sessionId: string; computerName: string; hint: string };

export interface DesktopPermissionState {
  computerId: string;
  computerName: string;
  allowed: boolean;
}
export type DesktopPermissionDecision = 'allow_once' | 'allow_future' | 'deny';
export interface DesktopPermissionRequest {
  requestId: string;
  workspaceId: string;
  agentId: string;
  agentName: string;
  computerId: string;
  computerName: string;
  claimsPrimary: boolean;
  expiresAt: string;
  options: { id: DesktopPermissionDecision; label: string }[];
}
export interface DesktopError {
  code: string;
  detail: string;
  execution?: 'not_started' | 'partial' | 'unknown';
}
export type DesktopEndReason =
  | 'agent_end'
  | 'user_stop'
  | 'primary_changed'
  | 'owner_changed'
  | 'disconnected'
  | 'screen_locked'
  | 'os_permission_lost'
  | 'lease_expired'
  | 'agent_terminated'
  | 'executor_failed'
  | 'unsupported_environment'
  | 'outcome_unknown';
export interface DesktopSessionChangedEvent {
  workspaceId: string;
  agentId: string;
  sessionId: string;
  computerId: string;
  computerName: string;
  status: 'active' | 'ended';
  reason?: DesktopEndReason;
  reportId?: string;
}
export interface DesktopPermissionResolvedEvent {
  workspaceId: string;
  agentId: string;
  requestId: string;
  outcome: 'granted' | 'denied' | 'expired' | 'withdrawn' | 'invalidated' | 'failed';
  state: DesktopState;
  error?: DesktopError;
}
export interface DesktopPermissionChangedEvent {
  workspaceId: string;
  agentId: string;
  permission: DesktopPermissionState;
}
type DesktopModifier = 'Shift' | 'Control' | 'Alt' | 'Meta';
interface DesktopPoint {
  x: number;
  y: number;
}
interface DesktopPosition extends DesktopPoint {
  displayId?: string;
  layoutId: string;
}
export type DesktopAction =
  | { kind: 'listDisplay' }
  | { kind: 'screenshot'; displayId?: string; layoutId?: string }
  | ({ kind: 'click'; button?: 'left' | 'right'; clickCount?: 1 | 2 } & DesktopPosition)
  | { kind: 'type'; text: string }
  | { kind: 'keypress'; key: string; modifiers?: DesktopModifier[] }
  | ({ kind: 'scroll'; deltaX: number; deltaY: number } & DesktopPosition)
  | { kind: 'drag'; displayId?: string; layoutId: string; from: DesktopPoint; to: DesktopPoint };
export interface DesktopDisplay {
  displayId: string;
  width: number;
  height: number;
  originX: number;
  originY: number;
  scaleFactor: number;
}
export interface DesktopDisplayList {
  layoutId: string;
  displays: DesktopDisplay[];
}
export interface DesktopScreenshotResult {
  capturedAt: string;
  layoutId: string;
  displays: (DesktopDisplay & { assetId: string; url: string; mimeType: 'image/png' })[];
}
