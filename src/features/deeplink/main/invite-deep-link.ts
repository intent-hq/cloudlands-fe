/**
 * Main-process handler for `intent://invite?...` deep links (multiplayer,
 * intentd #1872) — the guest side of a workspace invite. Modelled on
 * `pair-deep-link.ts`, with a device-flow join in the middle:
 *
 * 1. Parse the link and confirm with the user ("Join <host:port> as a
 *    guest?", cert fingerprint shown).
 * 2. Dial the daemon's unauthenticated `/invite` endpoint with the pin
 *    enforced at the TLS handshake and start the identity-only GitHub
 *    device flow (`invite.redeem { inviteId, secret }`).
 * 3. Show the user code + verification URL (code copied to the clipboard;
 *    "Open GitHub" opens the URL) while the second phase
 *    (`invite.redeem { flowId }`) waits for the grant.
 * 4. Store the minted credential as a GUEST session — never in the paired
 *    backend registry — and open the daemon's window.
 *
 * Security posture mirrors the pair flow: the invite secret and the minted
 * token are never logged (free-form error text is scrubbed), a link that
 * pins a certificate the host does not present is refused before a byte of
 * the secret leaves this process, and everything fails soft — a bad link
 * logs a scrubbed warning and returns; the app never crashes on it.
 */
import { app, clipboard, dialog, shell, type MessageBoxOptions } from 'electron';

import { Logger } from '$shared/logger';
import { m } from '$shared/paraglide/messages.js';
import { parseInviteUri } from '$shared/utils/invite-uri';
import { getMainWindow } from '../../../main/state';
import * as guestSessionsStore from '../../backend/main/guest-sessions-store';
import { openBackendWindow } from '../../backend/main/backend.ipc';
import { PinMismatchError } from '../../backend/main/backend-connection';
import {
  InviteRpcError,
  openInviteConnection,
  type InviteConnection,
} from '../../backend/main/invite-connection';
import { scrubToken } from '../utils/scrub-token';

const logger = new Logger('InviteDeepLink');

/** Local bound on the phase-2 wait beyond the daemon's own `expiresIn`. */
const WAIT_MARGIN_MS = 60_000;

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
  try {
    const parsed = parseInviteUri(url);
    if (!parsed) {
      logger.warn('Ignoring deep link that is not an invite URI');
      return;
    }
    const { hosts, port, fingerprint, inviteId, secret, tcAddress } = parsed;
    if (hosts.length === 0 || port === null || fingerprint === null || !inviteId || !secret) {
      // Presence booleans only — never the values (the secret must not leak).
      logger.warn('Ignoring invite link with missing required fields', {
        hasHost: hosts.length > 0,
        hasPort: port !== null,
        hasFingerprint: fingerprint !== null,
        hasInviteId: !!inviteId,
        hasSecret: !!secret,
      });
      return;
    }

    if (!(await confirmJoin(hosts[0], port, fingerprint))) {
      logger.info('User declined invite link');
      return;
    }

    connection = await openInviteConnection({ hosts, port, fingerprint });
    const start = await connection.redeemStart(inviteId, secret);
    // Phase 2 is issued right away so the grant is caught even while the code
    // dialog is up; the rejection is observed below (or ignored on cancel).
    const grant = connection.redeemWait(start.flowId, start.expiresIn * 1000 + WAIT_MARGIN_MS);
    grant.catch(() => {});

    clipboard.writeText(start.userCode);
    if (!(await showDeviceCode(start.userCode, start.verificationUri, start.workspaceTitle))) {
      logger.info('User cancelled the invite device flow');
      return;
    }
    void shell.openExternal(start.verificationUri);

    const credential = await grant;
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
    });
    logger.info('Joined workspace as a guest; opening the window', {
      id: record.id,
      workspaceId: credential.workspaceId,
    });
    await openBackendWindow(record.id);
  } catch (error) {
    logger.warn('Invite deep link handling failed', {
      error: scrubToken(error instanceof Error ? error.message : String(error)),
      inviteCode: error instanceof InviteRpcError ? error.inviteCode : null,
    });
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

async function showDialog(options: MessageBoxOptions): Promise<number> {
  const parent = getMainWindow();
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return result.response;
}

/** "Join <host:port> as a guest?" with the pinned fingerprint for cross-checking. */
async function confirmJoin(host: string, port: number, fingerprint: string): Promise<boolean> {
  const response = await showDialog({
    type: 'question',
    title: m.deeplink_inviteDialog_title(),
    message: m.deeplink_inviteDialog_message({ target: `${host}:${port}` }),
    detail: m.deeplink_pairDialog_detail({ fingerprint }),
    buttons: [m.deeplink_inviteDialog_join_button(), m.deeplink_pairDialog_cancel_button()],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0;
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

/** Map a redeem failure onto one user-facing sentence (routes on `error.data.code`). */
function describeInviteFailure(error: unknown): string {
  if (error instanceof PinMismatchError) return m.deeplink_inviteError_certMismatch();
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
    default:
      return m.deeplink_inviteError_generic();
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
    logger.warn('Could not show invite failure dialog', {
      error: dialogError instanceof Error ? dialogError.message : String(dialogError),
    });
  }
}
