/**
 * Browser access: the desktop app serves the web UI to a browser on another
 * device through a front-end such as `tailscale serve`. Main owns the setting
 * and the server; the renderer reads and changes it over BROWSER_ACCESS IPC.
 */

/** Default loopback port. */
export const BROWSER_ACCESS_DEFAULT_PORT = 47120;
/** Lowest port the setting accepts (avoids privileged ports). */
export const BROWSER_ACCESS_MIN_PORT = 1024;
export const BROWSER_ACCESS_MAX_PORT = 65_535;

/** Why the server is not running although enabled. */
export type BrowserAccessError = 'port-in-use' | 'permission-denied' | 'unavailable' | 'failed';

export interface BrowserAccessState {
  /** False when this build does not include the web UI. */
  readonly available: boolean;
  readonly enabled: boolean;
  /** Configured loopback port. */
  readonly port: number;
  /** True while the server is listening. */
  readonly running: boolean;
  /** Why the server could not start, when enabled but not running. */
  readonly error: BrowserAccessError | null;
  /** Key a browser enters once; resetting it signs every browser out. */
  readonly accessKey: string;
}

/** A single-use sign-in code created in Settings (see browser-access-sign-in-codes). */
export interface BrowserAccessSignInCode {
  /** Display form, `ABC-DEF`. */
  readonly code: string;
  /** Unix milliseconds. */
  readonly expiresAt: number;
  /** Link that opens the sign-in page with the code filled in; null until a browser has visited. */
  readonly link: string | null;
}

export function isValidBrowserAccessPort(port: unknown): port is number {
  return (
    typeof port === 'number' &&
    Number.isInteger(port) &&
    port >= BROWSER_ACCESS_MIN_PORT &&
    port <= BROWSER_ACCESS_MAX_PORT
  );
}
