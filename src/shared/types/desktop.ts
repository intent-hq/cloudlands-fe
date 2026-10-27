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
/** Observed macOS setup for one Allow gesture. Observation only, never a grant. */
export interface DesktopOsChecklist {
  accessibility: boolean;
  screenRecording: boolean;
  screenCapture: 'pending' | 'ready' | 'unavailable';
}
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
  /** Present only on `desktop-target-mismatch`. */
  reason?: DesktopTargetMismatchReason;
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
  windowId?: string;
}
export type DesktopAction =
  | { kind: 'listDisplay' }
  | { kind: 'screenshot'; displayId?: string; layoutId?: string }
  | ({ kind: 'move' } & DesktopPosition)
  | ({ kind: 'click'; button?: 'left' | 'right'; clickCount?: 1 | 2 } & DesktopPosition)
  | { kind: 'type'; text: string; windowId?: string }
  | { kind: 'keypress'; key: string; modifiers?: DesktopModifier[]; windowId?: string }
  | ({ kind: 'scroll'; deltaX: number; deltaY: number } & DesktopPosition)
  | {
      kind: 'drag';
      displayId?: string;
      layoutId: string;
      from: DesktopPoint;
      to: DesktopPoint;
      windowId?: string;
    }
  | { kind: 'focusWindow'; windowId: string };
/** Application receiving keyboard input when a screenshot was taken. */
export interface DesktopFrontmostApp {
  appName: string;
  bundleId?: string;
  pid: number;
  windowId?: string;
}
/** One eligible window, framed in the captured display's image pixels. */
export interface DesktopWindowMetadata {
  windowId: string;
  appName: string;
  bundleId?: string;
  pid: number;
  title?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  focused: boolean;
}
export type DesktopTargetMismatchReason =
  'window_unavailable' | 'not_frontmost' | 'outside_window' | 'obscured' | 'not_focused';
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
  frontmost?: DesktopFrontmostApp;
  windows: DesktopWindowMetadata[];
}
