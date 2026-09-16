/**
 * Main-process handler for `intent://invite?...` deep links (multiplayer,
 * intentd #1872) — the guest side of a workspace invite. Modelled on
 * `pair-deep-link.ts`, with a device-flow join in the middle:
 *
 * 1. Parse the link and dial the daemon's unauthenticated `/invite`
 *    endpoint with the pin enforced at the TLS handshake, then start the
 *    identity-only GitHub device flow (`invite.redeem { inviteId, secret }`).
 *    No fingerprint confirmation is asked of the user — the pin is checked
 *    mechanically at the handshake, not by eye.
 * 2. Show the user code + verification URL (code copied to the clipboard;
 *    "Open GitHub" opens the URL) while the second phase
 *    (`invite.redeem { flowId }`) waits for the grant. This dialog — which
 *    names the workspace and offers Cancel — is the single consent point. It
 *    renders in the renderer (`main/invite-consent.ts`, `invite-consent:*`
 *    channels) and stays up while the grant is awaited, where Cancel still
 *    aborts the join; with no window or no ack it falls back to the native
 *    message box so a cold start from a link never hangs.
 * 3. The grant is the point of no return: the host has minted the credential
 *    and consumed a seat, so the modal is dismissed (`joined`) the moment the
 *    grant resolves and a Cancel from then on is ignored. Store the minted
 *    credential as a GUEST session — never in the paired backend registry —
 *    and open the daemon's window; a store failure after the grant surfaces
 *    as a failure, never as a cancellation.
 *
 * Security posture mirrors the pair flow: the invite secret and the minted
 * token are never logged — failures are logged as bounded error kinds and
 * codes, never as free-form message text (a server or encryption error
 * string could echo a credential) — a link that pins a certificate the host
 * does not present is refused before a byte of the secret leaves this
 * process, the server-supplied verification URL is opened only when it is
 * an `https://github.com` URL (anything else fails the flow — the daemon
 * never sends another origin, and a compromised one must not be able to
 * launch arbitrary URLs), and everything fails soft — a bad link logs a
 * warning and returns; the app never crashes on it.
 */
import { app, clipboard, dialog, shell, type MessageBoxOptions } from 'electron';
import { randomUUID } from 'node:crypto';

import { Logger } from '$shared/logger';
import { m } from '$shared/paraglide/messages.js';
import { parseInviteUri } from '$shared/utils/invite-uri';
import { showInviteConsent, type InviteConsentPrompt } from '../../../main/invite-consent';
import { getMainWindow } from '../../../main/state';
import * as guestSessionsStore from '../../backend/main/guest-sessions-store';
import { openBackendWindow } from '../../backend/main/backend.ipc';
import { PinMismatchError } from '../../backend/main/backend-connection';
import {
  InviteRpcError,
  InviteTransportError,
  openInviteConnection,
  type InviteConnection,
} from '../../backend/main/invite-connection';
import { isAllowedVerificationUri } from '../utils/verification-uri';

const logger = new Logger('InviteDeepLink');

/** Local bound on the phase-2 wait beyond the daemon's own `expiresIn`. */
const WAIT_MARGIN_MS = 60_000;

/**
 * A flow failure decided locally, identified by a bounded code so logs and
 * the failure dialog route on it without any free-form text.
 */
type InviteFlowCode = 'invalid-verification-uri' | 'verification-launch-failed';

class InviteFlowError extends Error {
  constructor(readonly flowCode: InviteFlowCode) {
    // i18n-ignore (internal error, fixed text)
    super('invite flow refused');
    this.name = 'InviteFlowError';
  }
}

/**
 * In-flight guard (same rationale as the pair flow): a second invite link
 * while one is being redeemed is dropped instead of stacking dialogs.
 */
let inviteLinkInFlight = false;

/**
 * Handle an `intent://invite?...` deep link end to end. Resolves once the
 * flow completes (window opened, dialog cancelled, or link rejected); never
 * rejects — failures are logged (scrubbed) and surfaced in a native dialog.
 */
export async function handleInviteDeepLink(url: string): Promise<void> {
  if (inviteLinkInFlight) {
    logger.info('Ignoring invite link while another is being handled');
    return;
  }
  inviteLinkInFlight = true;
  let connection: InviteConnection | null = null;
  let consent: InviteConsentPrompt | null = null;
  try {
    const parsed = parseInviteUri(url);
    if (!parsed) {
      logger.warn('Ignoring deep link that is not an invite URI');
      return;
    }
    const { hosts, port, fingerprint, inviteId, secret, tcAddress } = parsed;
    // The daemon's default (loopback-bound) invite carries no direct host at
    // all — `host=` empty, `tc=` set — so a tunnel address satisfies the
    // "somewhere to dial" requirement on its own.
    const displayHost = hosts[0] ?? tcAddress;
    if (displayHost == null || port === null || fingerprint === null || !inviteId || !secret) {
      // Presence booleans only — never the values (the secret must not leak).
      logger.warn('Ignoring invite link with missing required fields', {
        hasHost: hosts.length > 0,
        hasTunnel: tcAddress !== null,
        hasPort: port !== null,
        hasFingerprint: fingerprint !== null,
        hasInviteId: !!inviteId,
        hasSecret: !!secret,
      });
      return;
    }

    connection = await openInviteConnection({ hosts, port, fingerprint, tcAddress });
    const start = await connection.redeemStart(inviteId, secret);
    // Refuse before the URL is shown or opened: the dialog would otherwise
    // display (and "Open GitHub" launch) whatever the server sent.
    if (!isAllowedVerificationUri(start.verificationUri)) {
      throw new InviteFlowError('invalid-verification-uri');
    }
    // Phase 2 is issued right away so the grant is caught even while the code
    // dialog is up; the rejection is observed below (or ignored on cancel).
    const grant = connection.redeemWait(start.flowId, start.expiresIn * 1000 + WAIT_MARGIN_MS);
    grant.catch(() => {});

    await clipboard.writeText(start.userCode);
    consent = showInviteConsent({
      requestId: randomUUID(),
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      workspaceTitle: start.workspaceTitle,
      hostLabel: connection.host,
      expiresInMs: start.expiresIn * 1000,
    });
    const decision = await consent.decision;
    if (decision === 'cancel') {
      consent.dismiss('cancelled');
      logger.info('User cancelled the invite device flow');
      return;
    }
    // No renderer to show the modal (cold start / no ack): native box.
    if (
      decision === null &&
      !(await showDeviceCode(start.userCode, start.verificationUri, start.workspaceTitle))
    ) {
      logger.info('User cancelled the invite device flow');
      return;
    }
    // From here the modal stays up in its waiting state and Cancel aborts the
    // join before any credential is minted — observed across both the browser
    // launch and the grant wait (a cancel that lands while the launch is still
    // pending must not be outrun by a grant that settles first), so the
    // cancel signal is created once and raced first at each step.
    let cancelledWhileWaiting = false;
    const cancelSignal = consent.cancelledWhileWaiting.then(() => {
      cancelledWhileWaiting = true;
      return null;
    });
    // The launch is awaited so a refused browser hand-off aborts the flow
    // before any credential is minted into the store; the OS error text is
    // dropped (bounded code only) since it may echo the URL or worse.
    const launch = (async () => {
      try {
        await shell.openExternal(start.verificationUri);
        return true;
      } catch {
        return false;
      }
    })();
    const launched = await Promise.race([cancelSignal, launch]);
    if (cancelledWhileWaiting) {
      consent.dismiss('cancelled');
      logger.info('User cancelled the invite while waiting for the GitHub grant');
      return;
    }
    if (!launched) {
      throw new InviteFlowError('verification-launch-failed');
    }

    const credential = await Promise.race([cancelSignal, grant]);
    if (cancelledWhileWaiting || credential === null) {
      consent.dismiss('cancelled');
      logger.info('User cancelled the invite while waiting for the GitHub grant');
      return;
    }
    // Point of no return: the host has minted the credential and consumed a
    // seat. Close the modal now — before the asynchronous store write — so
    // Cancel is neither offered nor honoured while the credential persists.
    consent.dismiss('joined');
    const record = await guestSessionsStore.add({
      label: connection.host,
      host: connection.host,
      hosts,
      port,
      fingerprint,
      tcAddress,
      principalId: credential.principalId,
      login: credential.login,
      token: credential.token,
      workspace: { id: credential.workspaceId, title: start.workspaceTitle },
    });
    logger.info('Joined workspace as a guest; opening the window', {
      id: record.id,
      workspaceId: credential.workspaceId,
      via: connection.via,
      tokenEncrypted: record.tokenEncrypted,
    });
    if (!record.tokenEncrypted) {
      // Flagged plaintext fallback (spec ruling): the join stands, but the
      // user learns the credential is not protected by OS encryption.
      await showPlaintextWarning();
    }
    await openBackendWindow(record.id);
  } catch (error) {
    logger.warn('Invite deep link handling failed', describeErrorForLog(error));
    // A no-op once the modal was dismissed `joined`; the failure box still shows.
    consent?.dismiss('failed');
    await showFailure(error);
  } finally {
    connection?.close();
    inviteLinkInFlight = false;
  }
}

/**
 * Route an invite link arriving from the OS (macOS `open-url`): handled
 * whenever the app is ready (no window needed — dialogs show parentless and
 * `openBackendWindow` creates its own window); parked before ready.
 */
export async function routeInviteLinkFromOs(
  url: string,
  park: (url: string) => Promise<void>,
): Promise<void> {
  if (app.isReady()) {
    await handleInviteDeepLink(url);
    return;
  }
  await park(url);
}

/**
 * Bounded log fields for a failure: error class and closed-set codes only.
 * The message text is deliberately dropped — it is server- or
 * library-authored free-form text that may carry the invite secret or the
 * minted token — and so is anything on the error beyond a known code
 * (`InviteRpcError.inviteCode` is already reduced to the documented set;
 * `transportCode` / `flowCode` / `code` below are local literals).
 */
function describeErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof PinMismatchError) return { kind: 'pin-mismatch' };
  if (error instanceof InviteRpcError) {
    return { kind: 'rpc', rpcCode: error.code, inviteCode: error.inviteCode };
  }
  if (error instanceof InviteTransportError) {
    return { kind: 'transport', transportCode: error.transportCode };
  }
  if (error instanceof InviteFlowError) return { kind: 'flow', flowCode: error.flowCode };
  if (error instanceof guestSessionsStore.GuestStoreCorruptError) {
    return { kind: 'store', code: error.code };
  }
  if (error instanceof guestSessionsStore.GuestEncryptionUnavailableError) {
    return { kind: 'store', code: error.code };
  }
  return { kind: error instanceof Error ? error.name : typeof error };
}

async function showDialog(options: MessageBoxOptions): Promise<number> {
  const parent = getMainWindow();
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return result.response;
}

/** Device-flow prompt: user code + verification URL. True when the user chose "Open GitHub". */
async function showDeviceCode(
  userCode: string,
  verificationUri: string,
  workspaceTitle: string,
): Promise<boolean> {
  const response = await showDialog({
    type: 'info',
    title: m.deeplink_inviteCode_title(),
    message: m.deeplink_inviteCode_message({
      code: userCode,
      url: verificationUri,
      workspace: workspaceTitle,
    }),
    detail: m.deeplink_inviteCode_detail(),
    buttons: [m.deeplink_inviteCode_open_button(), m.deeplink_pairDialog_cancel_button()],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0;
}

/**
 * Warn that the credential was stored in plaintext because OS encryption is
 * unavailable on this machine (flagged fallback); the join itself stands.
 */
async function showPlaintextWarning(): Promise<void> {
  await showDialog({
    type: 'warning',
    title: m.deeplink_invitePlaintext_title(),
    message: m.deeplink_invitePlaintext_message(),
    buttons: [m.deeplink_inviteFailed_ok_button()],
    defaultId: 0,
  });
}

/**
 * Map a failure onto one user-facing sentence: transport failures route on
 * `InviteTransportError.transportCode`, redeem refusals on `error.data.code`.
 */
function describeInviteFailure(error: unknown): string {
  if (error instanceof PinMismatchError) return m.deeplink_inviteError_certMismatch();
  if (error instanceof InviteTransportError) return describeTransportFailure(error);
  if (error instanceof guestSessionsStore.GuestEncryptionUnavailableError) {
    return m.deeplink_inviteError_encryptionUnavailable();
  }
  if (error instanceof guestSessionsStore.GuestStoreCorruptError) {
    return m.deeplink_inviteError_storeCorrupt();
  }
  if (error instanceof InviteFlowError && error.flowCode === 'verification-launch-failed') {
    return m.deeplink_inviteError_launchFailed();
  }
  const code = error instanceof InviteRpcError ? error.inviteCode : null;
  switch (code) {
    case 'invite-expired':
      return m.deeplink_inviteError_expired();
    case 'invite-revoked':
      return m.deeplink_inviteError_revoked();
    case 'invite-redeemed':
      return m.deeplink_inviteError_redeemed();
    case 'invite-pin-mismatch':
      return m.deeplink_inviteError_pinMismatch();
    case 'invite-flow-denied':
      return m.deeplink_inviteError_denied();
    case 'invite-flow-expired':
      return m.deeplink_inviteError_flowExpired();
    case 'workspace-full':
      return m.deeplink_inviteError_workspaceFull();
    default:
      return m.deeplink_inviteError_generic();
  }
}

/** One sentence per transport code — which of the distinct causes stopped the dial. */
function describeTransportFailure(error: InviteTransportError): string {
  switch (error.transportCode) {
    case 'tailcat-unavailable':
      return m.deeplink_inviteError_tailcatUnavailable();
    case 'tunnel-failed':
      return m.deeplink_inviteError_tunnelFailed();
    case 'host-unreachable':
      return m.deeplink_inviteError_hostUnreachable();
    case 'host-refused':
      return m.deeplink_inviteError_hostRefused();
    case 'connection-closed':
      return m.deeplink_inviteError_connectionClosed();
  }
}

async function showFailure(error: unknown): Promise<void> {
  try {
    await showDialog({
      type: 'error',
      title: m.deeplink_inviteFailed_title(),
      message: describeInviteFailure(error),
      buttons: [m.deeplink_inviteFailed_ok_button()],
      defaultId: 0,
    });
  } catch (dialogError) {
    logger.warn('Could not show invite failure dialog', describeErrorForLog(dialogError));
  }
}
