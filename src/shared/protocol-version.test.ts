// protocol-version-ok-file: version-gate boundary fixtures under test.
import { describe, expect, it } from 'vitest';
import { parseProtocolVersion, protocolMajor, protocolVersionAtLeast } from './protocol-version';
import { supportsReasoningEffortProtocol } from '$features/agent/utils/reasoning-effort-protocol';
import {
  supportsIdentitySeamProtocol,
  supportsSourceControlAuthProtocol,
} from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import { supportsIdempotentPlacementProtocol } from '$lib/components/chat/input/attachment-placement';
import { assertScopedFileReadSupport } from './root-file-read-support';

describe('parseProtocolVersion', () => {
  it('reads major.minor with an optional patch', () => {
    expect(parseProtocolVersion('15.0')).toEqual({ major: 15, minor: 0 });
    expect(parseProtocolVersion(' 10.12.3 ')).toEqual({ major: 10, minor: 12 });
  });
  it.each([undefined, null, 15, '', '15', '15.', '15.0.', 'v15.0', '15.0-rc1', '15.x', 'dev'])(
    'rejects %j',
    (value) => expect(parseProtocolVersion(value)).toBeNull(),
  );
});

describe('protocolVersionAtLeast', () => {
  it('compares numerically and defaults the minor to 0', () => {
    expect(protocolVersionAtLeast('10.10', 10, 4)).toBe(true);
    expect(protocolVersionAtLeast('10.3', 10, 4)).toBe(false);
    expect(protocolVersionAtLeast('9.99', 10)).toBe(false);
    expect(protocolVersionAtLeast('10.0', 10)).toBe(true);
  });
});

describe('protocol gates have no upper bound (intent-hq/intent#7206)', () => {
  const future = ['15.0', '15.3', '16.0', '16.2.1', '99.3'];
  it.each(future)('every frontend protocol gate accepts %s', (version) => {
    expect(supportsReasoningEffortProtocol(version)).toBe(true);
    expect(supportsIdempotentPlacementProtocol(version)).toBe(true);
    expect(supportsSourceControlAuthProtocol(version)).toBe(true);
    expect(supportsIdentitySeamProtocol(version)).toBe(true);
    expect(() =>
      assertScopedFileReadSupport('file.read', { gitRootId: 'root-a' }, version),
    ).not.toThrow();
  });
});

describe('protocolMajor', () => {
  it('reads the leading segment for the warn-only mismatch notice', () => {
    expect(protocolMajor('15.0')).toBe(15);
    expect(protocolMajor('1')).toBe(1);
    expect(protocolMajor('v2')).toBeNull();
  });
});
