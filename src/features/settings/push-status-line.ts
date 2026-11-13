import { m } from '$shared/paraglide/messages.js';
import type { PushStatus } from '$lib/client';
import { formatInteger } from '$lib/i18n/format';

type PushStatusFacts = Pick<PushStatus, 'enabled' | 'linked' | 'linkedDevices' | 'publishing'>;

/** One-line summary under the push switch; null while the relay is off. */
export function pushStatusLine(status: PushStatusFacts): string | null {
  if (!status.enabled) return null;
  if (status.publishing) {
    const count = status.linkedDevices;
    if (count === null || count < 1) return m.settings_push_sending();
    return count === 1
      ? m.settings_push_sendingCount_one({ count: formatInteger(count) })
      : m.settings_push_sendingCount_many({ count: formatInteger(count) });
  }
  return status.linked ? m.settings_push_paused() : m.settings_push_notLinked();
}
