/**
 * Platform capability service.
 *
 * Centralizes environment detection and per-feature capability gating so
 * Electron-only UI degrades cleanly when the renderer runs in a plain web
 * browser. UI gating sites should ask "can I do X?" via `hasCapability()`
 * instead of sniffing `window.electronAPI` truthiness.
 *
 * Note the difference from `isElectron()` in `$lib/electron-bridge`: that
 * helper only checks that `window.electronAPI` exists, so it returns `true`
 * when the dev browser mock (`$lib/browser-mock`) is installed. This module
 * treats the browser mock as the `web` platform, because the mock exists to
 * preview the UI in a browser — not to grant native capabilities.
 */

export type Platform = 'electron' | 'web';

export interface PlatformCapabilities {
  /** Native window chrome (traffic lights / drag regions / window controls). */
  windowChrome: boolean;
  /** Native open/save/message dialogs (`dialog:*` IPC). */
  nativeDialogs: boolean;
  /** Shell integration: reveal in Finder, open external URLs (`shell:*` IPC). */
  shellIntegration: boolean;
  /** Opening paths in external editors/terminals (`external-editors:*`, `vscode:open`, …). */
  externalEditors: boolean;
  /** Embedded browser panel backed by <webview> + CDP (`browser:*` IPC). */
  browserPanel: boolean;
  /** Auto-update flow (`auto-update:*` IPC). */
  autoUpdate: boolean;
  /** OS-level deeplink handling (intent:// protocol registration). */
  deeplinks: boolean;
  /** Native (OS) notifications via the main process. */
  nativeNotifications: boolean;
  /** SSH key selection / remote-env features that need local file access. */
  ssh: boolean;
}

/** Sentinel electron version injected by the dev browser mock. */
const BROWSER_MOCK_ELECTRON_VERSION = '0.0.0-browser';

/**
 * Detect the platform from a window-like object. Exported for tests;
 * application code should use `getPlatform()` / `hasCapability()`.
 */
export function detectPlatform(win: unknown): Platform {
  const api = (win as { electronAPI?: { versions?: { electron?: string } } } | undefined)
    ?.electronAPI;
  if (!api) return 'web';
  // The dev browser mock installs a fake electronAPI so the UI can render in
  // a browser; it must not be treated as a capable Electron environment.
  if (api.versions?.electron === BROWSER_MOCK_ELECTRON_VERSION) return 'web';
  return 'electron';
}

/** Current platform: `electron` when a real preload bridge is present, else `web`. */
export function getPlatform(): Platform {
  if (typeof window === 'undefined') return 'web';
  return detectPlatform(window);
}

/** True when running inside real Electron (not the dev browser mock). */
export function isElectronPlatform(): boolean {
  return getPlatform() === 'electron';
}

const ELECTRON_USER_AGENT_PATTERN = /\bElectron\/\d/;

/**
 * Whether the page is hosted by Electron, decided from the user agent rather
 * than from `window.electronAPI` presence. Chromium embeds `Electron/<version>`
 * in the default UA before any script runs, so this is answerable synchronously
 * at module-evaluation time and does not depend on the preload having loaded.
 * True for the app window and for pages inside the app's `<webview>` tabs.
 * Exported with an explicit `userAgent` for tests.
 */
export function isElectronRuntime(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : undefined);
  return typeof ua === 'string' && ELECTRON_USER_AGENT_PATTERN.test(ua);
}

/**
 * Whether this renderer is owed a real preload bridge: an Electron-built
 * renderer (`INTENT_BUILD_TARGET` is not `web`) running inside Electron. The
 * web build (`dev:web` / `build:web`) never receives a preload — even when it
 * is opened inside the app's own `<webview>`, which strips preloads and shares
 * the Electron UA — so it stays eligible for the browser mock.
 * `process.env.INTENT_BUILD_TARGET` is a Vite build-time define.
 */
export function expectsElectronPreloadBridge(userAgent?: string): boolean {
  const buildTarget = typeof process === 'undefined' ? undefined : process.env.INTENT_BUILD_TARGET;
  return isElectronRuntime(userAgent) && buildTarget !== 'web';
}

/** Capability profile for a given platform. */
export function capabilitiesForPlatform(platform: Platform): PlatformCapabilities {
  const electron = platform === 'electron';
  return {
    windowChrome: electron,
    nativeDialogs: electron,
    shellIntegration: electron,
    externalEditors: electron,
    browserPanel: electron,
    autoUpdate: electron,
    deeplinks: electron,
    nativeNotifications: electron,
    ssh: electron,
  };
}

/** Capability profile for the current environment. */
export function getCapabilities(): PlatformCapabilities {
  return capabilitiesForPlatform(getPlatform());
}

/** Check a single capability for the current environment. */
export function hasCapability(capability: keyof PlatformCapabilities): boolean {
  return getCapabilities()[capability];
}
