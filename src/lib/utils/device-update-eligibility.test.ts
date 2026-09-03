import { describe, it, expect } from 'vitest';
import { isDaemonBehindPin, canRequestDeviceUpdate } from './device-update-eligibility';

const remote = (daemonVersion?: string | null, updateSupported: boolean | null = true) => ({
  id: 'remote-1',
  daemonVersion,
  updateSupported,
  exactVersionUpdateSupported: true,
});

describe('isDaemonBehindPin', () => {
  it('is true when the daemon version is older than the pin', () => {
    expect(isDaemonBehindPin(remote('0.9.0'), '0.10.0')).toBe(true);
  });

  it('is false when the daemon version is newer than the pin', () => {
    expect(isDaemonBehindPin(remote('0.11.0'), '0.10.0')).toBe(false);
  });

  it('is false when the daemon version equals the pin', () => {
    expect(isDaemonBehindPin(remote('0.10.0'), '0.10.0')).toBe(false);
  });

  it('is false when the comparison is unknown (unparsable version)', () => {
    expect(isDaemonBehindPin(remote('not-a-version'), '0.10.0')).toBe(false);
    expect(isDaemonBehindPin(remote('0.9.0'), 'garbage')).toBe(false);
  });

  it('is false when daemonVersion is missing', () => {
    expect(isDaemonBehindPin(remote(null), '0.10.0')).toBe(false);
    expect(isDaemonBehindPin(remote(undefined), '0.10.0')).toBe(false);
    expect(isDaemonBehindPin(remote(''), '0.10.0')).toBe(false);
  });

  it('is false when the pin is missing', () => {
    expect(isDaemonBehindPin(remote('0.9.0'), null)).toBe(false);
    expect(isDaemonBehindPin(remote('0.9.0'), undefined)).toBe(false);
    expect(isDaemonBehindPin(remote('0.9.0'), '')).toBe(false);
  });

  it('is true for the local entry once its external daemon version is captured behind', () => {
    expect(isDaemonBehindPin({ id: 'local', daemonVersion: '0.9.0' }, '0.10.0')).toBe(true);
  });

  it('is false for the local sidecar entry (no captured version)', () => {
    expect(isDaemonBehindPin({ id: 'local' }, '0.10.0')).toBe(false);
  });

  it('handles a leading v and prerelease ordering', () => {
    expect(isDaemonBehindPin(remote('v0.9.0'), '0.10.0')).toBe(true);
    expect(isDaemonBehindPin(remote('0.10.0-alpha.1'), '0.10.0')).toBe(true);
  });
});

describe('canRequestDeviceUpdate', () => {
  it('is true when the daemon is behind the pin and the connection is connected', () => {
    expect(canRequestDeviceUpdate(remote('0.9.0'), ['remote-1'], '0.10.0')).toBe(true);
  });

  it('is false when the connection is not in connectedIds', () => {
    expect(canRequestDeviceUpdate(remote('0.9.0'), ['other'], '0.10.0')).toBe(false);
    expect(canRequestDeviceUpdate(remote('0.9.0'), [], '0.10.0')).toBe(false);
  });

  it('is false when connectedIds is undefined', () => {
    expect(canRequestDeviceUpdate(remote('0.9.0'), undefined, '0.10.0')).toBe(false);
  });

  it('is false when the daemon is not behind the pin, even if connected', () => {
    expect(canRequestDeviceUpdate(remote('0.10.0'), ['remote-1'], '0.10.0')).toBe(false);
    expect(canRequestDeviceUpdate(remote('0.11.0'), ['remote-1'], '0.10.0')).toBe(false);
  });

  it('is true for the connected local entry with an external daemon behind and update support', () => {
    expect(
      canRequestDeviceUpdate(
        {
          id: 'local',
          daemonVersion: '0.9.0',
          updateSupported: true,
          exactVersionUpdateSupported: true,
        },
        ['local'],
        '0.10.0',
      ),
    ).toBe(true);
  });

  it('is false for the local sidecar entry (no captured version/support), even if connected', () => {
    expect(canRequestDeviceUpdate({ id: 'local' }, ['local'], '0.10.0')).toBe(false);
  });

  it('is false when daemonVersion or the pin is missing', () => {
    expect(canRequestDeviceUpdate(remote(null), ['remote-1'], '0.10.0')).toBe(false);
    expect(canRequestDeviceUpdate(remote('0.9.0'), ['remote-1'], null)).toBe(false);
  });

  it('is false when the daemon reports updateSupported: false', () => {
    expect(canRequestDeviceUpdate(remote('0.9.0', false), ['remote-1'], '0.10.0')).toBe(false);
  });

  it('is false while updateSupported is unknown (absent/null) — strict gating', () => {
    expect(canRequestDeviceUpdate(remote('0.9.0', null), ['remote-1'], '0.10.0')).toBe(false);
    expect(
      canRequestDeviceUpdate(
        { id: 'remote-1', isLocal: false, daemonVersion: '0.9.0' },
        ['remote-1'],
        '0.10.0',
      ),
    ).toBe(false);
  });

  it.each([undefined, null, false])(
    'never infers exact support from legacy support: %s',
    (capability) => {
      expect(
        canRequestDeviceUpdate(
          { ...remote('0.9.0'), exactVersionUpdateSupported: capability },
          ['remote-1'],
          '0.10.0',
        ),
      ).toBe(false);
    },
  );

  it.each([
    'v0.10.0',
    '^0.10.0',
    '0.10.0+build',
    '0.10.0-beta..1',
    '0.10.0-01',
    '00.10.0',
    '../0.10.0',
    '18446744073709551616.1.0',
  ])('rejects malformed exact pin %s', (pin) => {
    expect(canRequestDeviceUpdate(remote('0.9.0'), ['remote-1'], pin)).toBe(false);
  });

  it('preserves valid exact prerelease pin eligibility', () => {
    expect(canRequestDeviceUpdate(remote('0.10.0-beta.1'), ['remote-1'], '0.10.0-beta.2')).toBe(
      true,
    );
  });

  it('does not affect isDaemonBehindPin (informational badge stays)', () => {
    expect(isDaemonBehindPin(remote('0.9.0', false), '0.10.0')).toBe(true);
    expect(isDaemonBehindPin(remote('0.9.0', null), '0.10.0')).toBe(true);
  });
});
