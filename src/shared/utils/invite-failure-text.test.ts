import { describe, expect, it } from 'vitest';
import { describeInviteFailureReason } from './invite-failure-text';

describe('invite account recovery text', () => {
  it.each([
    'pin-mismatch',
    'identity-unavailable',
    'proof-gitlab-not-connected',
    'proof-gitlab-scope-missing',
  ] as const)('points %s to Connections without a GitLab opt-in step', (reason) => {
    const text = describeInviteFailureReason(reason);
    expect(text).toContain('Settings → Connections');
    expect(text).not.toMatch(/experimental|command menu/i);
  });
});
