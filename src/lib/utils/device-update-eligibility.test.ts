import { describe, it, expect } from 'vitest';
import { isDaemonBehindPin, canRequestDeviceUpdate } from './device-update-eligibility';

const remote = (daemonVersion?: string | null) => ({
  id: 'remote-1',
  isLocal: false,
  daemonVersion,
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

  it('is never true for the local entry', () => {
    expect(
      isDaemonBehindPin({ id: 'local', isLocal: true, daemonVersion: '0.9.0' }, '0.10.0'),
    ).toBe(false);
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

  it('is false for the local entry, even if listed as connected', () => {
    expect(
      canRequestDeviceUpdate(
        { id: 'local', isLocal: true, daemonVersion: '0.9.0' },
        ['local'],
        '0.10.0',
      ),
    ).toBe(false);
  });

  it('is false when daemonVersion or the pin is missing', () => {
    expect(canRequestDeviceUpdate(remote(null), ['remote-1'], '0.10.0')).toBe(false);
    expect(canRequestDeviceUpdate(remote('0.9.0'), ['remote-1'], null)).toBe(false);
  });
});
