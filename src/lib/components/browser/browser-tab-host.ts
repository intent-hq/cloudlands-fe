/**
 * Host of a daemon-owned browser tab as seen by a viewer client (REV-2,
 * spec Model 3). The host runs the live webview; every other client mirrors
 * the canonical URL and forwards navigation to the host.
 */
export interface BrowserTabHost {
  /** Host client display name (hello host triple or `name`, else a shortened id). */
  name: string;
  /** Whether the host client currently has a live connection. */
  connected: boolean;
}
