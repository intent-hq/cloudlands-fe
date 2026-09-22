/**
 * Invite-notice IPC payload contract (main ⇄ renderer).
 *
 * The main process (`src/main/invite-notice.ts`) renders the two one-button
 * notices of an `intent://invite` join (`features/deeplink/main/invite-deep-link.ts`)
 * in the renderer instead of native message boxes: the "could not join" failure
 * and the "credential stored without encryption" warning. Same shape as the
 * invite-consent prompt (`./invite-consent.ts`): show → ack within a short
 * window (else native fallback) → response → dismiss.
 *
 * Security posture: the payload carries bounded codes and display labels only.
 * The failure `reason` is a closed union mapped from the error classes in
 * main — never the error's message text, which is server- or library-authored
 * and may echo the invite secret or the minted token. The renderer maps the
 * reason onto its sentence itself (`$shared/utils/invite-failure-text`).
 *
 * Channels (see `IPC_CHANNELS.INVITE_NOTICE` in `../ipc-registry`):
 *
 * - `invite-notice:show` (main → renderer, `webContents.send`):
 *   {@link InviteNoticeShowPayload}. Sent to the focused/main window.
 * - `invite-notice:ack` (renderer → main, `invoke`):
 *   {@link InviteNoticeAckPayload}. The renderer MUST invoke this as soon as
 *   the modal mounts — main only waits a short window for the ack before
 *   dismissing the request and falling back to the native dialog.
 * - `invite-notice:response` (renderer → main, `invoke`):
 *   {@link InviteNoticeResponsePayload}. The user acknowledged the notice —
 *   OK, Escape, backdrop and × all map to the one response.
 * - `invite-notice:dismiss` (main → renderer, `webContents.send`):
 *   {@link InviteNoticeDismissPayload}. Close the modal for a request main
 *   gave up on (no ack in time; the native fallback showed instead).
 *
 * Kept in `src/shared/` so both processes import the same shapes; the Zod
 * schemas validating the renderer → main payloads live in
 * `src/main/ipc-schemas.ts`.
 */

/** Which notice to render. */
type InviteNoticeKind = 'failed' | 'plaintext';

/**
 * Why an invite join failed — the bounded set the failure dialog routes on.
 * Host refusals mirror the daemon's documented `invite.challenge` /
 * `invite.prove` / `invite.accept` codes, transport codes mirror
 * `InviteTransportError.transportCode`, the `proof-*` codes are the guest's
 * own daemon refusing to publish the identity proof, `github-rate-limited` is
 * the guest's own daemon being rate limited by GitHub (probe or proof), `denied` /
 * `flow-expired` / `sign-in-failed` / `launch-failed` are the guest's own
 * GitHub sign-in ending without a token, and the rest are local failure
 * classes; `generic` covers everything else.
 */
export type InviteFailureReason =
  | 'expired'
  | 'revoked'
  | 'redeemed'
  | 'pin-mismatch'
  | 'proof-invalid'
  | 'proof-expired'
  | 'host-github-unreachable'
  | 'workspace-full'
  | 'owner-self-join'
  | 'denied'
  | 'flow-expired'
  | 'sign-in-failed'
  | 'launch-failed'
  | 'proof-not-connected'
  | 'proof-scope-missing'
  | 'proof-github-unreachable'
  | 'proof-failed'
  | 'github-rate-limited'
  | 'cert-mismatch'
  | 'tailcat-unavailable'
  | 'tunnel-failed'
  | 'host-unreachable'
  | 'host-refused'
  | 'connection-closed'
  | 'encryption-unavailable'
  | 'store-corrupt'
  | 'generic';

/** `invite-notice:show` payload (main → renderer). */
export interface InviteNoticeShowPayload {
  requestId: string;
  kind: InviteNoticeKind;
  /** Set for `failed`; absent for `plaintext`. */
  reason?: InviteFailureReason;
  /** Title of the workspace being joined, when known at the time of the notice. */
  workspaceTitle?: string;
  /** Host (or tunnel address) of the daemon, when the dial got that far. */
  hostLabel?: string;
}

/** `invite-notice:ack` payload (renderer → main invoke). */
export interface InviteNoticeAckPayload {
  requestId: string;
}

/** `invite-notice:response` payload (renderer → main invoke). */
export interface InviteNoticeResponsePayload {
  requestId: string;
}

/** `invite-notice:dismiss` payload (main → renderer). */
export interface InviteNoticeDismissPayload {
  requestId: string;
}
