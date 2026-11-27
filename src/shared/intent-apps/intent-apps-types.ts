/**
 * Intent apps (Labs): the wire shapes of `docs/protocol/methods/apps.md`
 * (§5.60, capability `server.capabilities.intentApps: 1`) and the state that
 * main pushes to renderers. Main owns the library and the app windows; the
 * renderer only shows this state and sends user requests.
 *
 * This file has no imports so main, preload-free tests and the renderer can load it.
 */

/** `^[a-z0-9](?:[a-z0-9-]{1,62})[a-z0-9]$` (3–64 chars), from the manifest rules. */
const INTENT_APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62})[a-z0-9]$/;

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

interface IntentAppWindowSpec {
  width: number;
  height: number;
  minWidth: number | null;
  minHeight: number | null;
  resizable: boolean;
  alwaysOnTop: boolean;
}

type IntentAppApprovalStatus = 'pending' | 'approved' | 'revoked';

interface IntentAppApproval {
  status: IntentAppApprovalStatus;
  level: 1 | 2 | null;
  features: string[];
  bundleHash: string | null;
  approvedAt: string | null;
}

/**
 * Publisher data from the manifest. Reserved in M1: the daemon checks only its
 * shape and never verifies it, so the UI must never show it as confirmed.
 */
interface IntentAppPublisher {
  name: string;
  url: string | null;
  keyId: string | null;
  verified: boolean;
}

/** The bundle's `intent-app.sig`, stored but not verified in M1 (`status: "unverified"`). */
interface IntentAppSignature {
  sigVersion: number;
  algorithm: string;
  keyId: string;
  bundleHash: string;
  signature: string;
  status: 'unverified' | 'valid' | 'invalid' | 'untrusted-key';
  verified: boolean;
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
  publisher: IntentAppPublisher | null;
  updateUrl: string | null;
  signature: IntentAppSignature | null;
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

/** Main → renderer: a package install result, with the upload it used (kept after a dry run). */
export interface IntentAppPackageInstallResult extends IntentAppInstallResult {
  uploadId: string;
}

/**
 * Main → renderer: the whole library state of the renderer's machine
 * (`intent-apps:changed`, `intent-apps:get-state`). Each window sees the
 * library of the machine it is connected to.
 */
export interface IntentAppsState {
  /** The Labs switch (main owns it). */
  labEnabled: boolean;
  /** The daemon of the renderer's machine advertises `intentApps: 1`. */
  supported: boolean;
  /** It also advertises `intentAppPackages: 1`: it installs uploaded app packages. */
  packages: boolean;
  /** Installed apps on the daemon of the renderer's machine, sorted like `app.list`. */
  apps: IntentApp[];
  /** Apps of that machine with a window open in this desktop app. */
  openAppIds: string[];
  /** The last library read failed (display only). */
  error: string | null;
}

export const INTENT_APPS_OFF_STATE: IntentAppsState = {
  labEnabled: false,
  supported: false,
  packages: false,
  apps: [],
  openAppIds: [],
  error: null,
};

/** A renderer request that failed: the daemon `data.code` when it had one. */
export interface IntentAppsActionError {
  code: string;
  message: string;
  /** A failed package check: the upload it kept, to check again or discard. */
  uploadId?: string;
}

export type IntentAppsActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { result: T }))
  | { ok: false; error: IntentAppsActionError };

/** Platform name that `intent.app.info()` reports. */
export type IntentAppPlatform = 'mac' | 'windows' | 'linux' | 'intent-os';

/**
 * Window title of an app window (spec 3.4; Intent OS finds the window by it).
 * An app of another machine names that machine, so two machines' copies of
 * one app never share a title; Intent OS matches local apps by the exact
 * `Intent App: <name>` title and gives every `Intent App: ` window its own
 * workspace.
 */
export function intentAppWindowTitle(name: string, machineLabel?: string | null): string {
  return machineLabel ? `Intent App: ${name} (${machineLabel})` : `Intent App: ${name}`;
}

/**
 * Session partition of an app (browser storage, IndexedDB). Uninstall clears
 * it. The local machine keeps the contract name `persist:intent-app-<appId>`;
 * an app of another machine adds that machine's key, so each machine's copy
 * keeps its own storage.
 */
export function intentAppPartition(appId: string, machineKey?: string | null): string {
  return machineKey
    ? `persist:intent-app-${appId}-on-${machineKey}`
    : `persist:intent-app-${appId}`;
}

/** Whether an app can be opened: approved for the installed hash. */
export function isIntentAppOpenable(app: IntentApp): boolean {
  return app.approval.status === 'approved' && app.approval.bundleHash === app.bundleHash;
}
