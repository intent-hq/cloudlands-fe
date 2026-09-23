/**
 * Invite-progress IPC payload contract (main ⇄ renderer).
 *
 * The main process (`src/main/invite-progress.ts`) shows a progress dialog
 * with a Cancel button in the focused window during the two silent phases of
 * an `intent://invite` join (`features/deeplink/main/invite-deep-link.ts`):
 *
 * - `connecting`: the link was parsed and main is reaching the host, up to
 *   the moment the consent (Join) prompt appears.
 * - `opening`: the host committed the join (point of no return) and main is
 *   opening the guest window.
 *
 * Same round-trip as the invite consent prompt (`./invite-consent.ts`),
 * plus an `update` that moves the dialog between phases without a remount:
 * show → ack within a short window → (update)* → response? → dismiss.
 * Unlike consent there is NO native fallback: when no renderer window can
 * show the dialog (cold start) or the ack never arrives, main simply proceeds
 * without progress UI.
 *
 * Nothing secret crosses this boundary: payloads carry a request id, the
 * phase and display labels only — never the invite secret, the minted token,
 * or any URL (the host is a display label, not an address to connect to).
 *
 * Channels (see `IPC_CHANNELS.INVITE_PROGRESS` in `../ipc-registry`):
 *
 * - `invite-progress:show` (main → renderer, `webContents.send`):
 *   {@link InviteProgressShowPayload}. Sent to the focused/main window.
 * - `invite-progress:update` (main → renderer, `webContents.send`):
 *   {@link InviteProgressUpdatePayload}. New phase / labels for the request
 *   the renderer is already showing; ignored for any other request.
 * - `invite-progress:ack` (renderer → main, `invoke`):
 *   {@link InviteProgressAckPayload}. The renderer MUST invoke this as soon
 *   as the modal mounts — main only waits a short window for the ack before
 *   giving up on the dialog for this request (and dismissing it).
 * - `invite-progress:response` (renderer → main, `invoke`):
 *   {@link InviteProgressResponsePayload}. Escape / backdrop / × / Cancel
 *   all map to `cancel`; a response for a request that is no longer active
 *   is ignored.
 * - `invite-progress:dismiss` (main → renderer, `webContents.send`):
 *   {@link InviteProgressDismissPayload}. Close the modal for a request that
 *   finished (its phase ended, the join failed or was cancelled) or that main
 *   gave up waiting on; the renderer ignores it for any request that is not
 *   its current one.
 *
 * Kept in `src/shared/` so both processes import the same shapes; the Zod
 * schemas validating the renderer → main payloads live in
 * `src/main/ipc-schemas.ts`.
 */

/** Which silent phase of the join the dialog describes. */
export type InviteProgressPhase = 'connecting' | 'opening';

/** The only action the dialog offers. */
export type InviteProgressAction = 'cancel';

/** `invite-progress:show` payload (main → renderer). */
export interface InviteProgressShowPayload {
  requestId: string;
  phase: InviteProgressPhase;
  /** Host (or tunnel address) being connected to — a display label only. */
  hostLabel?: string;
  /** Title of the workspace being joined / opened. */
  workspaceTitle?: string;
}

/** `invite-progress:update` payload (main → renderer): same request, new phase / labels. */
export type InviteProgressUpdatePayload = InviteProgressShowPayload;

/** `invite-progress:ack` payload (renderer → main invoke). */
export interface InviteProgressAckPayload {
  requestId: string;
}

/** `invite-progress:response` payload (renderer → main invoke). */
export interface InviteProgressResponsePayload {
  requestId: string;
  action: InviteProgressAction;
}

/** `invite-progress:dismiss` payload (main → renderer). */
export interface InviteProgressDismissPayload {
  requestId: string;
}
