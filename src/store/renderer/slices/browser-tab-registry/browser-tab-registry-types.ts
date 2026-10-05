/**
 * Browser Tab Registry Types (renderer)
 *
 * Per-workspace lifecycle of this client's view of the daemon tab registry
 * (REV-2 §5.45), owned by the reducer so the registry saga's asynchronous
 * work can be fenced against teardown instead of racing it.
 *
 * ```text
 * unmounted ──settle / connect (gen+1)──▶ loading ──rows applied──▶ applied ──first report──▶ reporting
 *     ▲                                       │                        │                          │
 *     └──────── teardown (gen+1): unmount / delete / clear ────────────┴──────────────────────────┘
 * ```
 *
 * `generation` grows on every transition out of `unmounted` and back into
 * it; a saga step that started under generation N and observes N+1 discards
 * its result. Only `applied` / `reporting` workspaces report tabs or take
 * part in a `browser.syncTabs` snapshot. A reported tab that leaves the
 * layout is recorded in `closing` at the mutation that removed it, so the
 * close survives an unmount or an unreachable daemon. A hosted tab whose URL
 * is the row's copy is `unresolved` until its tunnel re-resolution is
 * established, so a failed resolution is retried at the next load instead of
 * leaving the tab on a dead port.
 */

import type { BrowserTabInput } from '$shared/types/browser-clients';

type BrowserTabRegistryPhase = 'unmounted' | 'loading' | 'applied' | 'reporting';

export type WorkspaceBrowserTabRegistryState = {
  /** Layout lifetime counter; bumped on load and on teardown, never restarts. */
  generation: number;
  phase: BrowserTabRegistryPhase;
  /** What the daemon holds for the tabs this client hosts, by tab id. */
  reported: Record<string, BrowserTabInput>;
  /**
   * Hosted tabs filled from a row whose tunnel re-resolution has not been
   * established: their URL is the row's copy, not the guest's, so the next
   * load re-resolves them. Cleared by an established resolution, or with the
   * tab's report.
   */
  unresolved: Record<string, true>;
};

/**
 * A tab closed here whose removal the daemon has not confirmed: `pending`
 * while `browser.removeTab` is unsent / in flight / failed (the next
 * snapshot omits it so the daemon deletes it), `acknowledged` once the call
 * succeeded and until its `browser:tab-closed` echo lands. Its rows and
 * echoes are ignored either way — rematerialising it would undo the close.
 */
export type BrowserTabClosingState = 'pending' | 'acknowledged';

export type BrowserTabRegistryState = {
  byWorkspaceId: Record<string, WorkspaceBrowserTabRegistryState>;
  closing: Record<string, BrowserTabClosingState>;
};

export const emptyWorkspaceBrowserTabRegistryState: WorkspaceBrowserTabRegistryState = {
  generation: 0,
  phase: 'unmounted',
  reported: {},
  unresolved: {},
};

export const initialState: BrowserTabRegistryState = {
  byWorkspaceId: {},
  closing: {},
};
