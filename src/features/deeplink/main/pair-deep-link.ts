/**
 * Main-process handler for `intent://pair?...` deep links (PROTOCOL §5
 * pairing URI): parse the link, match it against the stored connections by
 * pairing identity (cert fingerprint first, normalized host:port fallback —
 * `connectionsStore.findMatching`), and either connect/foreground the known
 * backend's window or — after a native confirmation dialog — register the new
 * backend and open it.
 *
 * Security posture:
 * - The bearer token from the link goes straight to the connections store
 *   (which encrypts it at rest) and is NEVER logged — log lines carrying
 *   free-form error text are scrubbed first.
 * - A known-server link never rewrites stored credentials: re-pairing lives
 *   in the settings flow, so a clicked link can't silently replace a good
 *   token with an attacker-supplied one.
 * - Everything fails soft: a malformed or incomplete link logs a scrubbed
 *   warning and returns; the app never crashes on a bad link.
 */
import { dialog, type MessageBoxOptions } from 'electron';

import { Logger } from '$shared/logger';
import { m } from '$shared/paraglide/messages.js';
import { parsePairingUri } from '$lib/utils/pairing-uri';
import { getMainWindow } from '../../../main/state';
import * as connectionsStore from '../../backend/main/connections-store';
import { openBackendWindow } from '../../backend/main/backend.ipc';
import { scrubToken } from '../utils/scrub-token';

const logger = new Logger('PairDeepLink');

/**
 * Handle an `intent://pair?...` deep link end to end. Resolves once the flow
 * completes (window opened, dialog cancelled, or link rejected); never
 * rejects — all failures are logged (scrubbed) and swallowed.
 */
export async function handlePairDeepLink(url: string): Promise<void> {
  try {
    const parsed = parsePairingUri(url);
    if (!parsed) {
      logger.warn('Ignoring deep link that is not a pairing URI');
      return;
    }
    const { hosts, port, fingerprint, token, tcAddress } = parsed;
    if (hosts.length === 0 || port === null || fingerprint === null || token === null) {
      // Presence booleans only — never the values (the token must not leak).
      logger.warn('Ignoring pairing link with missing required fields', {
        hasHost: hosts.length > 0,
        hasPort: port !== null,
        hasFingerprint: fingerprint !== null,
        hasToken: token !== null,
      });
      return;
    }

    const existing = await connectionsStore.findMatching({ hosts, port, fingerprint });
    if (existing) {
      // Known server: connect if needed and open-or-focus its window. Do NOT
      // rewrite the stored credentials from a clicked link (see header).
      logger.info('Pairing link matches a known backend; opening its window', {
        id: existing.id,
      });
      await openBackendWindow(existing.id);
      return;
    }

    const host = hosts[0];
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
    logger.warn('Pair deep link handling failed', {
      error: scrubToken(error instanceof Error ? error.message : String(error)),
    });
  }
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
