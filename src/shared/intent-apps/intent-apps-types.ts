/**
 * Intent apps (Labs): the wire shapes of `docs/protocol/methods/apps.md`
 * (§5.60, capability `server.capabilities.intentApps: 1`) and the state that
 * main pushes to renderers. Main owns the library and the app windows; the
 * renderer only shows this state and sends user requests.
 *
 * This file has no imports so main, preload-free tests and the renderer can load it.
 */

/** `^[a-z0-9](?:[a-z0-9-]{1,62})[a-z0-9]$` (3–64 chars), from the manifest rules. */
export const INTENT_APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62})[a-z0-9]$/;

export function isIntentAppId(value: unknown): value is string {
  return typeof value === 'string' && INTENT_APP_ID_PATTERN.test(value);
}

export type IntentAppFeature = 'notifications' | 'models' | 'globalShortcuts' | 'alwaysOnTop';

export const INTENT_APP_FEATURES: readonly IntentAppFeature[] = [
  'notifications',
  'models',
  'globalShortcuts',
  'alwaysOnTop',
];

export interface IntentAppWindowSpec {
  width: number;
  height: number;
  minWidth: number | null;
  minHeight: number | null;
  resizable: boolean;
  alwaysOnTop: boolean;
}

export type IntentAppApprovalStatus = 'pending' | 'approved' | 'revoked';

export interface IntentAppApproval {
  status: IntentAppApprovalStatus;
  level: 1 | 2 | null;
  features: string[];
  bundleHash: string | null;
  approvedAt: string | null;
}

/** `App` from app.list / app.get / app.install. Every key is always present. */
export interface IntentApp {
  id: string;
  name: string;
  version: string;
  description: string | null;
  icon: string | null;
  entry: string;
  bundleHash: string;
  fileCount: number;
  sizeBytes: number;
  permissions: { level: 1 | 2 | 3; features: string[] };
  window: IntentAppWindowSpec;
  approval: IntentAppApproval;
  source: { workspaceId: string; path: string } | null;
  installedAt: string;
  updatedAt: string;
  open: boolean;
}

/** `AppSession` from app.session.open (with `token`) and app.session.attach (without). */
export interface IntentAppSession {
  sessionId: string;
  token?: string;
  appId: string;
  bundleHash: string;
  level: 1 | 2 | 3;
  features: string[];
  entry: string;
  window: IntentAppWindowSpec;
}

export interface IntentAppInstallResult {
  app: IntentApp;
  replaced: boolean;
  approvalReset: boolean;
  dryRun: boolean;
}

/** Why the library is not shown. `null` when it is. */
export type IntentAppsUnavailableReason = 'lab-off' | 'unsupported' | 'disconnected';

/** Main → renderer: the whole library state (`intent-apps:changed`, `intent-apps:get-state`). */
export interface IntentAppsState {
  /** The Labs switch (main owns it). */
  labEnabled: boolean;
  /** The local daemon advertises `intentApps: 1`. */
  supported: boolean;
  /** Installed apps on this computer's daemon, sorted like `app.list`. */
  apps: IntentApp[];
  /** Apps with a window open in this desktop app. */
  openAppIds: string[];
  /** The last library read failed (display only). */
  error: string | null;
}

export const INTENT_APPS_OFF_STATE: IntentAppsState = {
  labEnabled: false,
  supported: false,
  apps: [],
  openAppIds: [],
  error: null,
};

/** A renderer request that failed: the daemon `data.code` when it had one. */
export interface IntentAppsActionError {
  code: string;
  message: string;
}

export type IntentAppsActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { result: T }))
  | { ok: false; error: IntentAppsActionError };

/** Platform name that `intent.app.info()` reports. */
export type IntentAppPlatform = 'mac' | 'windows' | 'linux' | 'intent-os';

/** Window title of an app window (spec 3.4; Intent OS finds the window by it). */
export function intentAppWindowTitle(name: string): string {
  return `Intent App: ${name}`;
}

/** Wayland app_id / X11 class of an app window, where the platform allows it. */
export function intentAppWindowClass(appId: string): string {
  return `intent-app-${appId}`;
}

/** Session partition of an app (browser storage, IndexedDB). Uninstall clears it. */
export function intentAppPartition(appId: string): string {
  return `persist:intent-app-${appId}`;
}

/** Whether an app can be opened: approved for the installed hash. */
export function isIntentAppOpenable(app: IntentApp): boolean {
  return app.approval.status === 'approved' && app.approval.bundleHash === app.bundleHash;
}
