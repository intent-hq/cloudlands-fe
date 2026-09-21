/**
 * Browser CDP invoke bridge — forwards `browser:list-tabs-response` (and the
 * paired tab-registration channels) to the real Electron preload bridge
 * (`window.electronAPI.invoke`) when present.
 *
 * The generated `invoke()` routes ALL legacy renderer invokes through the
 * mock router in every build, including the packaged app. The browser IPC
 * saga's reply to main's `browser:list-tabs-request` —
 * `invoke('browser:list-tabs-response', { tabs, requestId })` — was an
 * UNBRIDGED_INVOKE_ALLOWLIST absence justified as "unreachable in this build";
 * that was written for the bridge-less web build, but in the packaged app the
 * request DOES fire and the saga DOES answer. The reply resolved `undefined`
 * in the renderer without ever reaching `ipcMain`, so every
 * `requestPanelBrowserTabs` hit the 500 ms timeout, the per-workspace tab
 * cache was never seeded, and agent `listTabs` / `closeTab` / open-tab dedupe
 * (all gated on `listAllTabs`) failed persistently with "the renderer did not
 * respond and no cached tab list exists" (intent-hq/monorepo#2926). The
 * hydration-failed truthful-error reply (monorepo#2789) and post-restart
 * ownership rehydration (monorepo#2857) ride the same channel and were
 * equally dead.
 *
 * `browser:register-tab` / `browser:report-tab-bounds` shared the same stale
 * allowlist disposition. Their current callers (EmbeddedBrowser.svelte,
 * offscreen-webview-action.ts, tab-bounds-action.ts) bypass the router by
 * calling `window.electronAPI?.invoke` directly — which is why tab
 * registration kept working — but any future routed caller would have been
 * silently swallowed the same way, so they are bridged here too.
 *
 * Same pattern as window-state-bridge-seeder (monorepo#2746, the same defect
 * class on window:set-theme): forward verbatim when the preload bridge
 * exists; resolve undefined when it does not (browser dev / bridge-less
 * build). Callers must treat the forwarded invoke as fallible: it now
 * reaches the real ipcMain handler, so a main-side throw rejects (the
 * browser-ipc saga catch-guards its reply invokes accordingly).
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const BROWSER_INVOKE_CHANNELS = [
  IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE,
  IPC_CHANNELS.BROWSER.REGISTER_TAB,
  IPC_CHANNELS.BROWSER.REPORT_TAB_BOUNDS,
  IPC_CHANNELS.BROWSER.SET_TAB_VIEWPORT,
  IPC_CHANNELS.BROWSER.OPEN_DEVTOOLS_PANEL,
  // Owned-tab destruction (monorepo#2857): daemon-events-bridge and the
  // panel-layout saga invoke this through the routed path on agent deletion /
  // workspace archive; without the forward, main's CDP/ownership
  // registrations would never be cleared in the packaged app.
  IPC_CHANNELS.BROWSER.CLEAR_AGENT_TABS,
] as const;

/** Register the browser CDP invoke bridge handlers. Idempotent. */
export function registerBrowserIpcBridge(): void {
  for (const channel of BROWSER_INVOKE_CHANNELS) {
    // Forward exactly one payload argument — the real preload bridge signature
    // is `invoke(channel, data?)`, so extra args would be silently dropped.
    registerMockIpcHandler(channel, async (payload?: unknown) => {
      const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (bridge && typeof bridge.invoke === 'function') {
        return bridge.invoke(channel, payload);
      }
      return undefined;
    });
  }
}

registerBrowserIpcBridge();
