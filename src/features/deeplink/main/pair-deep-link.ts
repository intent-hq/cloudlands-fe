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
import { isNodeInviteUri } from '$shared/utils/node-invite-uri';
import { getMainWindow } from '../../../main/state';
import * as connectionsStore from '../../backend/main/desktop-connections-store';
import * as guestSessionsStore from '../../backend/main/guest-sessions-store';
import {
  BackendCompatibilityError,
  inspectPairCredential,
  invitedRole,
} from '../../backend/main/invited-principal';
import { canonicalFingerprint } from '../../backend/main/invited-session-key';
import { captureInviteAttempt } from './invite-attempt';
import { NodeWindowRefusedError, openBackendWindow } from '../../backend/main/backend.ipc';
import { getPairLinks } from '../../backend/main/pair-link.ipc';
import { getNodeInvites } from '../../backend/main/remote-machines.ipc';
import type { TestedPairLink } from '../../backend/main/pair-link';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { queueDeepLinkForWindow } from './pending-deep-links';

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
  let addedId: string | null = null;
  const attempt = captureInviteAttempt();
  try {
    if (isNodeInviteUri(url)) {
      await routeNodeInvite(url);
      return;
    }
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
    // One credential test for every principal kind; it also detects the mode.
    const tested = await inspectPairCredential({
      host,
      hosts,
      port,
      fingerprint,
      token,
      tcAddress,
    });
    const remote = tested.snapshot;
    const role = invitedRole(remote);
    if (role) {
      if (!attempt.current() || !attempt.allowed()) return;
      const people = await guestSessionsStore.findAllMatching(fingerprint);
      const known = people.find((row) => row.principalId === remote.principal.id);
      if (!known && !(await confirmNewBackend(host, port, fingerprint))) return;
      if (!attempt.current() || !attempt.allowed()) return;
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
          mayOpen: () => attempt.current() && attempt.allowed(),
        });
      return;
    }
    // Legacy isAdministrator remains sufficient for the established owner-only pairing path.
    if (!remote.principal.isAdministrator) return;
    const daemonMode = tested.daemonMode ?? (parsed.modeHint === 'node' ? 'node' : null);
    // Unknown mode: saving could keep a node the backend can't use, so stop here.
    if (!daemonMode) throw new Error('Daemon mode unknown');
    if (daemonMode === 'node') {
      await routeNodeLink({
        hosts,
        port,
        fingerprint,
        token,
        tcAddress,
        modeHint: parsed.modeHint,
        daemonMode: tested.daemonMode,
        name: tested.name,
      });
      return;
    }
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
      daemonMode,
    });
    if (!existing) addedId = record.id;
    logger.info('Added backend from pairing link; opening its window', { id: record.id });
    await openBackendWindow(record.id);
  } catch (error) {
    if (error instanceof NodeWindowRefusedError) {
      // Detected as a node only when its window was about to open. A record
      // this link just added goes to the app window, which removes it when the
      // backend can't use nodes, or asks to make it available.
      logger.info('Pairing link is for a node; no backend window opened');
      if (addedId === error.connectionId) await handOffSavedNode(addedId);
      return;
    }
    logger.warn('Pair deep link handling failed', { kind: 'pairing-failed' });
    const options: MessageBoxOptions = {
      type: error instanceof BackendCompatibilityError ? 'warning' : 'error',
      title: m.deeplink_pairFailure_title(),
      message:
        error instanceof BackendCompatibilityError
          ? error.message
          : m.deeplink_pairFailure_message(),
    };
    await showMessage(options);
  } finally {
    attempt.release();
    pairLinkInFlight = false;
  }
}

/**
 * A node's link never opens a backend window: the app comes to the front and
 * its window asks whether to make the node available (Settings → Machines).
 * Only the pending id crosses to the renderer; the credential stays in main.
 * The renderer then saves it, or refuses it (nothing saved) when the current
 * backend can't run agents on other machines.
 */
/** The app window, opening the local one when the app has none. */
async function appWindow() {
  let window = getMainWindow();
  if (!window || window.isDestroyed()) {
    await openBackendWindow(LOCAL_CONNECTION_ID);
    window = getMainWindow();
  }
  return window && !window.isDestroyed() ? window : null;
}

function bringToFront(window: NonNullable<ReturnType<typeof getMainWindow>>) {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** A just-saved record turned out to be a node: the app window decides (refuse or ask). */
async function handOffSavedNode(connectionId: string): Promise<void> {
  const window = await appWindow();
  if (!window) return;
  queueDeepLinkForWindow(window, { type: 'node-link', params: { connectionId, added: 'true' } });
  bringToFront(window);
}

async function routeNodeLink(link: TestedPairLink): Promise<void> {
  const links = getPairLinks();
  const held = await links.hold(link);
  const window = await appWindow();
  if (!window) {
    links.discard(held.pendingId);
    throw new Error('No app window to ask in');
  }
  logger.info('Pairing link is for a node; asking in the app window');
  queueDeepLinkForWindow(window, {
    type: 'node-link',
    params: {
      pendingId: held.pendingId,
      label: held.label,
      existingId: held.existingId ?? '',
    },
  });
  bringToFront(window);
}

/**
 * An `intent://node` link: main holds it, the app window asks and the current
 * backend claims it. Only the pending id and the name reach the renderer.
 */
async function routeNodeInvite(url: string): Promise<void> {
  const invites = getNodeInvites();
  const held = invites.inspect(url);
  if (!held.ok) {
    logger.warn('Ignoring node link', { code: held.code });
    await showMessage({
      type: 'error',
      title: m.nodes_inviteFailure_title(),
      message:
        held.code === 'link-version' ? m.nodes_error_linkVersion() : m.nodes_error_incomplete(),
    });
    return;
  }
  const window = await appWindow();
  if (!window) {
    invites.discard(held.pendingId);
    throw new Error('No app window to ask in');
  }
  logger.info('Node link received; asking in the app window');
  queueDeepLinkForWindow(window, {
    type: 'node-invite',
    params: { pendingId: held.pendingId, label: held.label ?? '' },
  });
  bringToFront(window);
}

async function showMessage(options: MessageBoxOptions): Promise<void> {
  try {
    const parent = getMainWindow();
    if (parent && !parent.isDestroyed()) await dialog.showMessageBox(parent, options);
    else await dialog.showMessageBox(options);
  } catch {
    logger.warn('Could not show pairing failure dialog');
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
