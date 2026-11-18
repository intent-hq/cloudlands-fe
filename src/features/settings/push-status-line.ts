import { m } from '$shared/paraglide/messages.js';
import type { PushStatus } from '$lib/client';
import { formatInteger } from '$lib/i18n/format';

type PushStatusFacts = Pick<PushStatus, 'enabled' | 'linkedDevices' | 'publishing'>;

/**
 * One-line summary under the push switch; null while the relay is off. Only a
 * confirmed zero phone count says no phone is linked: not publishing also
 * covers a relay that is unreachable or still starting.
 */
export function pushStatusLine(status: PushStatusFacts): string | null {
  if (!status.enabled) return null;
  const count = status.linkedDevices;
  if (count === 0) return m.settings_push_notLinked();
  if (!status.publishing) return m.settings_push_paused();
  if (count === null) return m.settings_push_sending();
  return count === 1
    ? m.settings_push_sendingCount_one({ count: formatInteger(count) })
    : m.settings_push_sendingCount_many({ count: formatInteger(count) });
}
