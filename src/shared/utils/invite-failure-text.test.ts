import { describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { describeInviteFailureReason } from './invite-failure-text';

describe('invite account recovery text', () => {
  it.each([
    'pin-mismatch',
    'identity-unavailable',
    'proof-gitlab-not-connected',
    'proof-gitlab-scope-missing',
  ] as const)(
    'names the current GitLab opt-in command for %s, including native notices',
    (reason) => {
      const text = describeInviteFailureReason(reason);
      expect(text).toContain(m.lib_commandPalette_enableExperimentalGitlab_label());
    },
  );

  it.each(['host-unreachable', 'proof-gitlab-unreachable', 'generic'] as const)(
    'keeps unrelated %s recovery unchanged',
    (reason) => {
      expect(describeInviteFailureReason(reason)).not.toContain(
        m.lib_commandPalette_enableExperimentalGitlab_label(),
      );
    },
  );
});
