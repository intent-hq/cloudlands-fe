import { describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { describeInviteFailureReason } from './invite-failure-text';

describe('invite account recovery text', () => {
  it.each([
    'pin-mismatch',
    'identity-unavailable',
    'proof-gitlab-not-connected',
    'proof-gitlab-scope-missing',
  ] as const)('explains how to reveal hidden Labs for %s, including native notices', (reason) => {
    const text = describeInviteFailureReason(reason);
    expect(text).toContain(m.lib_commandPalette_showLabsInSettings_label());
    expect(text).toContain('If the required account is on GitLab');
    expect(text).toContain('Settings → Connections');
  });

  it.each(['host-unreachable', 'proof-gitlab-unreachable', 'generic'] as const)(
    'keeps unrelated %s recovery unchanged',
    (reason) => {
      expect(describeInviteFailureReason(reason)).not.toContain(
        m.lib_commandPalette_showLabsInSettings_label(),
      );
    },
  );
});
