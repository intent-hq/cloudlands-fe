import { describe, expect, it } from 'vitest';
import type { CapabilityStatus } from '../controller';
import { getSetupStatus } from './setup-status';

const readyCapabilities: Record<'provider' | 'git' | 'node' | 'github', CapabilityStatus> = {
  provider: 'ready',
  git: 'ready',
  node: 'ready',
  github: 'ready',
};

describe('new-workspace setup status', () => {
  it('ignores capabilities that are not required to start', () => {
    expect(
      getSetupStatus({
        source: null,
        capabilities: { ...readyCapabilities, node: 'missing' },
        requiredCapabilities: ['provider'],
      }),
    ).toEqual({ readiness: 'ready', canStart: true });
  });

  it('keeps Start disabled while a required check is pending', () => {
    expect(
      getSetupStatus({
        source: null,
        capabilities: { ...readyCapabilities, github: 'pending' },
        requiredCapabilities: ['provider', 'github'],
      }),
    ).toEqual({ readiness: 'checking', canStart: false });
  });

  it('requires valid source data and required capabilities', () => {
    expect(
      getSetupStatus({
        source: { kind: 'newFolder', parentPath: '/projects', name: '../outside' },
        capabilities: readyCapabilities,
        requiredCapabilities: ['provider'],
      }),
    ).toEqual({ readiness: 'attention', canStart: false });
    expect(
      getSetupStatus({
        source: null,
        capabilities: { ...readyCapabilities, provider: 'missing' },
        requiredCapabilities: ['provider'],
      }),
    ).toEqual({ readiness: 'attention', canStart: false });
  });
});
