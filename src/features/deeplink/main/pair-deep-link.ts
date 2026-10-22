/**
 * Main-process handler for `intent://pair?...` deep links (PROTOCOL §5
 * pairing URI): authenticate the pinned bearer and classify the remote principal.
 * Personal member/guest credentials enter the existing invited-session registry;
 * administrator credentials retain the owner pairing and confirmation flow.
 *
 * Security posture:
 * - Bearers stay in main and encrypted storage; diagnostics contain bounded fields.
 * - Personal sessions deduplicate by verified principal and pin, never host alone.
 * - Known owner links open the saved connection without replacing its credential.
 * - Malformed or incomplete links return without changing either registry.
 */
import { app, dialog, type MessageBoxOptions } from 'electron';

import { Logger } from '$shared/logger';
import { m } from '$shared/paraglide/messages.js';
import { parsePairingUri } from '$shared/utils/pairing-uri';
import { getMainWindow } from '../../../main/state';
import * as connectionsStore from '../../backend/main/connections-store';
import * as guestSessionsStore from '../../backend/main/guest-sessions-store';
import {
  BackendCompatibilityError,
  inspectPersonalCredential,
  invitedRole,
} from '../../backend/main/invited-principal';
import { canonicalFingerprint } from '../../backend/main/invited-session-key';
import { captureInviteAttempt } from './invite-attempt';
import { openBackendWindow } from '../../backend/main/backend.ipc';

const logger = new Logger('PairDeepLink');

/**
 * In-flight guard: a pair link arriving while another is being handled is
 * dropped. Without it, two rapid clicks (or a spammed `second-instance`) run
 * the flow concurrently — both `findMatching` calls miss the same new server
 * and stack two confirm dialogs. `add()` is an identity-keyed upsert so the
 * outcome is benign either way; this just avoids the double dialog.
 */
let pairLinkInFlight = false;

/**
 * Handle an `intent://pair?...` deep link end to end. Resolves once the flow
 * completes (window opened, dialog cancelled, or link rejected); never
 * rejects — failures are logged without secrets and shown in a native dialog. Concurrent
 * calls are dropped while one is in flight (see `pairLinkInFlight`).
 */
export async function handlePairDeepLink(url: string): Promise<void> {
  if (pairLinkInFlight) {
    logger.info('Ignoring pairing link while another is being handled');
    return;
  }
  pairLinkInFlight = true;
  const attempt = captureInviteAttempt();
  try {
    const parsed = parsePairingUri(url);
    if (!parsed) {
      logger.warn('Ignoring deep link that is not a pairing URI');
      return;
    }
    const { hosts, port, fingerprint, token, tcAddress } = parsed;
    if (
      (hosts.length === 0 && !tcAddress) ||
      port === null ||
      fingerprint === null ||
      token === null
    ) {
      // Presence booleans only — never the values (the token must not leak).
      logger.warn('Ignoring pairing link with missing required fields', {
        hasHost: hosts.length > 0,
        hasPort: port !== null,
        hasFingerprint: fingerprint !== null,
        hasToken: token !== null,
      });
      return;
    }

    const host = hosts[0] ?? tcAddress!;
    const remote = await inspectPersonalCredential({
      host,
      hosts,
      port,
      fingerprint,
      token,
      tcAddress,
    });
    const role = invitedRole(remote);
    if (role) {
      if (!attempt.current() || !attempt.allowed(remote.principal.identity?.provider)) return;
      const people = await guestSessionsStore.findAllMatching(fingerprint);
      const known = people.find((row) => row.principalId === remote.principal.id);
      if (!known && !(await confirmNewBackend(host, port, fingerprint))) return;
      if (!attempt.current() || !attempt.allowed(remote.principal.identity?.provider)) return;
      const record = await guestSessionsStore.add({
        label: host,
        host,
        hosts,
        port,
        fingerprint,
        tcAddress,
        token,
        principalId: remote.principal.id,
        login: remote.principal.login,
        identity: remote.principal.identity,
        hostRole: role,
      });
      if (attempt.current())
        await openBackendWindow(record.id, {
          mayOpen: () => attempt.current() && attempt.allowed(remote.principal.identity?.provider),
        });
      return;
    }
    // Legacy isAdministrator remains sufficient for the established owner-only pairing path.
    if (!remote.principal.isAdministrator) return;
    const existing = await connectionsStore.findMatching({ hosts, port, fingerprint });
    if (
      existing?.fingerprint &&
      canonicalFingerprint(existing.fingerprint) === canonicalFingerprint(fingerprint)
    ) {
      // Known server: connect if needed and open-or-focus its window. Do NOT
      // rewrite the stored credentials from a clicked link (see header).
      logger.info('Pairing link matches a known backend; opening its window', {
        id: existing.id,
      });
      await openBackendWindow(existing.id);
      return;
    }

    if (!(await confirmNewBackend(host, port, fingerprint))) {
      logger.info('User declined pairing link for a new backend');
      return;
    }
    const record = await connectionsStore.add({
      label: host,
      host,
      port,
      fingerprint,
      token,
      ...(tcAddress !== null ? { tcAddress } : {}),
    });
    logger.info('Added backend from pairing link; opening its window', { id: record.id });
    await openBackendWindow(record.id);
  } catch (error) {
    logger.warn('Pair deep link handling failed', { kind: 'pairing-failed' });
    const options: MessageBoxOptions = {
      type: error instanceof BackendCompatibilityError ? 'warning' : 'error',
      title: m.deeplink_pairFailure_title(),
      message:
        error instanceof BackendCompatibilityError
          ? error.message
          : m.deeplink_pairFailure_message(),
    };
    try {
      const parent = getMainWindow();
      if (parent && !parent.isDestroyed()) await dialog.showMessageBox(parent, options);
      else await dialog.showMessageBox(options);
    } catch {
      logger.warn('Could not show pairing failure dialog');
    }
  } finally {
    attempt.release();
    pairLinkInFlight = false;
  }
}

/**
 * Route a pair link arriving from the OS (macOS `open-url`). The pair flow
 * owner path needs no existing window — its confirm dialog can show parentless.
 * Personal imports require the original renderer's invitation policy. The link is handled
 * whenever the app is ready. This covers macOS staying alive with zero
 * windows open, where a window-gated route would park the link forever
 * (the pending slot is only drained once, during startup). Before ready,
 * `park` stores it for the startup pending-URL pass.
 */
export async function routePairLinkFromOs(
  url: string,
  park: (url: string) => Promise<void>,
): Promise<void> {
  if (app.isReady()) {
    await handlePairDeepLink(url);
    return;
  }
  await park(url);
}

/**
 * Native confirmation before adding a backend the app has never seen:
 * "Connect to <host:port>?" with the cert fingerprint shown so the user can
 * cross-check it against the daemon's pairing screen. Parented to the main
 * window when one exists. Returns true only on explicit confirm.
 */
async function confirmNewBackend(
  host: string,
  port: number,
  fingerprint: string,
): Promise<boolean> {
  const options: MessageBoxOptions = {
    type: 'question',
    title: m.deeplink_pairDialog_title(),
    message: m.deeplink_pairDialog_message({ target: `${host}:${port}` }),
    detail: m.deeplink_pairDialog_detail({ fingerprint }),
    buttons: [m.deeplink_pairDialog_connect_button(), m.deeplink_pairDialog_cancel_button()],
    defaultId: 0,
    cancelId: 1,
  };
  const parent = getMainWindow();
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}
