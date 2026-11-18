import { describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { pushStatusLine } from './push-status-line';

const off = { enabled: false, linkedDevices: null, publishing: false };
const on = { ...off, enabled: true };

describe('pushStatusLine', () => {
  it('shows nothing while the relay is off, even with stale link facts', () => {
    expect(pushStatusLine({ ...off, linkedDevices: 2, publishing: true })).toBeNull();
  });

  it('counts phones while publishing', () => {
    expect(pushStatusLine({ ...on, publishing: true, linkedDevices: 1 })).toBe(
      m.settings_push_sendingCount_one({ count: '1' }),
    );
    expect(pushStatusLine({ ...on, publishing: true, linkedDevices: 2 })).toBe(
      m.settings_push_sendingCount_many({ count: '2' }),
    );
  });

  it('falls back to a countless line before the relay reports devices', () => {
    expect(pushStatusLine({ ...on, publishing: true })).toBe(m.settings_push_sending());
  });

  it('says no phone is linked only for a confirmed zero count', () => {
    expect(pushStatusLine({ ...on, linkedDevices: 0 })).toBe(m.settings_push_notLinked());
    expect(pushStatusLine({ ...on, linkedDevices: 0, publishing: true })).toBe(
      m.settings_push_notLinked(),
    );
  });

  it('stays neutral when not publishing for another reason', () => {
    expect(pushStatusLine({ ...on })).toBe(m.settings_push_paused());
    expect(pushStatusLine({ ...on, linkedDevices: 2 })).toBe(m.settings_push_paused());
  });
});
