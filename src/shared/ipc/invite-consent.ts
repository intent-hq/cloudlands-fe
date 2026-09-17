/**
 * Invite-consent IPC payload contract (main ⇄ renderer).
 *
 * The main process (`src/main/invite-consent.ts`) renders the consent prompt
 * of an `intent://invite` join (`features/deeplink/main/invite-deep-link.ts`)
 * in the renderer instead of a native message box, in one of two modes:
 *
 * - `device-code`: a first join on this host. The modal shows the device code
 *   + verification URL, explains why the sign-in is needed and what the host
 *   learns, and — after "Open GitHub" — stays up in a "waiting for GitHub"
 *   state until main dismisses it.
 * - `confirm`: a returning guest that already holds a credential for this
 *   host (`invite.accept`). No device code or URL: the modal names the
 *   identity the host already knows ("Signed in on this host as @login"),
 *   keeps the "what the host learns" section, and its primary button is
 *   "Join"; after "Join" it stays up in a brief "joining" state until main
 *   dismisses it.
 *
 * Same shape as the quit-confirmation prompt (`./quit-confirmation.ts`):
 * show → ack within a short window (else native fallback) → response →
 * dismiss.
 *
 * Security posture stays in main: the verification URL is allowlisted there
 * before this payload is built, `shell.openExternal` runs in main on `open`,
 * and the invite secret / minted token never appear in any payload.
 *
 * Channels (see `IPC_CHANNELS.INVITE_CONSENT` in `../ipc-registry`):
 *
 * - `invite-consent:show` (main → renderer, `webContents.send`):
 *   {@link InviteConsentShowPayload}. Sent to the focused/main window.
 * - `invite-consent:ack` (renderer → main, `invoke`):
 *   {@link InviteConsentAckPayload}. The renderer MUST invoke this as soon as
 *   the modal mounts — main only waits a short window for the ack before
 *   dismissing the request and falling back to the native dialog.
 * - `invite-consent:response` (renderer → main, `invoke`):
 *   {@link InviteConsentResponsePayload}. `open` = the primary action ("Open
 *   GitHub" in `device-code` mode, "Join" in `confirm` mode); Escape /
 *   backdrop / × / Cancel all map to `cancel`. A `cancel` may also arrive after
 *   `open`, while the modal is in its waiting state — it aborts the join until
 *   the GitHub grant resolves; a `cancel` that lands after main dismissed the
 *   request as `joined` is ignored (logged, never a cancellation).
 * - `invite-consent:dismiss` (main → renderer, `webContents.send`):
 *   {@link InviteConsentDismissPayload}. Close the modal for a request that
 *   settled (joined / failed / cancelled) or was superseded (main gave up
 *   waiting for the ack and used the native fallback). `joined` is sent the
 *   moment the grant resolves — before the credential is persisted — so the
 *   modal leaves its waiting state at the point of no return.
 *
 * Kept in `src/shared/` so both processes import the same shapes; the Zod
 * schemas validating the renderer → main payloads live in
 * `src/main/ipc-schemas.ts`.
 */

/** The user's decision on the consent modal (`open` is the primary action in either mode). */
export type InviteConsentAction = 'open' | 'cancel';

/** Why the modal is being closed. */
export type InviteConsentOutcome = 'joined' | 'failed' | 'cancelled';

interface InviteConsentShowBase {
  requestId: string;
  /** Which prompt the modal renders. */
  mode: 'device-code' | 'confirm';
  /** Title of the workspace being joined. */
  workspaceTitle: string;
  /** Host (or tunnel address) of the daemon that runs the identity check. */
  hostLabel: string;
}

/** `invite-consent:show` payload for a first join: the GitHub device flow. */
interface InviteConsentDeviceCodePayload extends InviteConsentShowBase {
  mode: 'device-code';
  /** GitHub device-flow user code (already copied to the clipboard by main). */
  userCode: string;
  /** Allowlisted `https://github.com/...` device-flow URL; opened by main on `open`. */
  verificationUri: string;
  /** Lifetime of the device code, from the daemon's `expiresIn`. */
  expiresInMs: number;
}

/** `invite-consent:show` payload for a returning guest: confirm with the stored identity. */
interface InviteConsentConfirmPayload extends InviteConsentShowBase {
  mode: 'confirm';
  /** GitHub login the stored credential for this host belongs to. */
  login: string;
}

/** `invite-consent:show` payload (main → renderer). */
export type InviteConsentShowPayload = InviteConsentDeviceCodePayload | InviteConsentConfirmPayload;

/** `invite-consent:ack` payload (renderer → main invoke). */
export interface InviteConsentAckPayload {
  requestId: string;
}

/** `invite-consent:response` payload (renderer → main invoke). */
export interface InviteConsentResponsePayload {
  requestId: string;
  action: InviteConsentAction;
}

/** `invite-consent:dismiss` payload (main → renderer). */
export interface InviteConsentDismissPayload {
  requestId: string;
  outcome: InviteConsentOutcome;
}
