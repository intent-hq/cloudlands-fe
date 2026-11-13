import { describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { pushStatusLine } from './push-status-line';

const off = { enabled: false, linked: false, linkedDevices: null, publishing: false };

describe('pushStatusLine', () => {
  it('shows nothing while the relay is off, even with stale link facts', () => {
    expect(pushStatusLine({ ...off, linked: true, linkedDevices: 2, publishing: true })).toBeNull();
  });

  it('counts phones while publishing', () => {
    const on = { ...off, enabled: true, linked: true, publishing: true };
    expect(pushStatusLine({ ...on, linkedDevices: 1 })).toBe(
      m.settings_push_sendingCount_one({ count: '1' }),
    );
    expect(pushStatusLine({ ...on, linkedDevices: 2 })).toBe(
      m.settings_push_sendingCount_many({ count: '2' }),
    );
  });

  it('falls back to a countless line before the relay reports devices', () => {
    expect(
      pushStatusLine({ ...off, enabled: true, linked: false, linkedDevices: null, publishing: true }),
    ).toBe(m.settings_push_sending());
  });

  it('asks to link a phone when the caller has no link', () => {
    expect(pushStatusLine({ ...off, enabled: true })).toBe(m.settings_push_notLinked());
  });

  it('reports paused when linked but not publishing', () => {
    expect(pushStatusLine({ ...off, enabled: true, linked: true, linkedDevices: 0 })).toBe(
      m.settings_push_paused(),
    );
  });
});
