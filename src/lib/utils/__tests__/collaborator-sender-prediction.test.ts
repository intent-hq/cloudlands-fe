import { describe, expect, it } from 'vitest';
import {
  getCollaboratorSenderAttribution,
  predictOwnSenderAttribution,
} from '../collaborator-sender-attribution';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

const principal = {
  id: 'principal-self',
  login: 'octocat',
  displayName: 'The Octocat',
  avatarUrl: 'https://avatars.example/octocat.png',
};
const workspace = {
  id: 'ws-shared',
  ownerPrincipalId: 'principal-owner',
  myRole: 'collaborator' as const,
};

// Daemon templates (intentd harness v1 / v2_9, PROTOCOL §5.5) for the principal above.
const GUEST_PREAMBLE =
  'Message from @octocat (The Octocat), a collaborator (guest) of this workspace — not the workspace owner.';
const MEMBER_PREAMBLE =
  'Message from @octocat (The Octocat), a host member (principal principal-self; github@github.com user 42) — not the workspace owner.';

describe('predictOwnSenderAttribution', () => {
  it('predicts the guest template for a guest collaborator', () => {
    const predicted = predictOwnSenderAttribution({ hostRole: 'guest', principal, workspace });
    expect(predicted).toEqual({
      role: 'guest',
      preamble: GUEST_PREAMBLE,
      author: {
        principalId: 'principal-self',
        login: 'octocat',
        displayName: 'The Octocat',
        avatarUrl: 'https://avatars.example/octocat.png',
      },
    });
  });

  it('predicts the member template, with identity, for a host member', () => {
    const identity = { provider: 'github' as const, host: 'github.com', externalUserId: '42' };
    const predicted = predictOwnSenderAttribution({
      hostRole: 'member',
      principal: { ...principal, identity },
      workspace: { ...workspace, myRole: 'owner' },
    });
    expect(predicted?.role).toBe('member');
    expect(predicted?.preamble).toBe(MEMBER_PREAMBLE);
    expect(predicted?.author.identity).toEqual(identity);
  });

  it('matches what the confirmed row resolves to once the daemon prepends the preamble', () => {
    const identity = { provider: 'github' as const, host: 'github.com', externalUserId: '42' };
    for (const [hostRole, preamble, self] of [
      ['guest', GUEST_PREAMBLE, principal],
      ['member', MEMBER_PREAMBLE, { ...principal, identity }],
    ] as const) {
      const predicted = predictOwnSenderAttribution({ hostRole, principal: self, workspace });
      const confirmed = getCollaboratorSenderAttribution(
        {
          role: 'user',
          author: {
            principalId: self.id,
            login: self.login,
            displayName: self.displayName,
            avatarUrl: self.avatarUrl,
            ...('identity' in self ? { identity: self.identity } : {}),
          },
          metadata: { fromPrincipalId: self.id },
          contentBlocks: [{ type: 'text', text: `${preamble}\n\nhello` }],
        },
        workspace.ownerPrincipalId,
      );
      expect(confirmed).not.toBeNull();
      expect(predicted).toEqual(confirmed);
    }
  });

  it.each([
    ['the workspace owner', { hostRole: 'owner' as const }],
    ['a host member in the chief workspace', { hostRole: 'member' as const, chief: true }],
    ['a guest without the collaborator role', { hostRole: 'guest' as const, myRole: 'owner' }],
    ['a guest with no workspace role', { hostRole: 'guest' as const, myRole: null }],
    ['an unknown host role', { hostRole: null }],
    ['a viewer who owns the workspace', { hostRole: 'member' as const, ownsWorkspace: true }],
    ['a workspace served without an owner', { hostRole: 'member' as const, noOwner: true }],
  ] as const)('predicts nothing for %s', (_label, scenario) => {
    const s = scenario as {
      hostRole: 'owner' | 'member' | 'guest' | null;
      chief?: boolean;
      myRole?: 'owner' | null;
      ownsWorkspace?: boolean;
      noOwner?: boolean;
    };
    expect(
      predictOwnSenderAttribution({
        hostRole: s.hostRole,
        principal,
        workspace: {
          id: s.chief ? CHIEF_WORKSPACE_ID : workspace.id,
          ownerPrincipalId: s.noOwner
            ? undefined
            : s.ownsWorkspace
              ? principal.id
              : workspace.ownerPrincipalId,
          myRole: 'myRole' in s ? s.myRole : workspace.myRole,
        },
      }),
    ).toBeNull();
  });

  it('predicts nothing until the principal and workspace are known', () => {
    expect(
      predictOwnSenderAttribution({ hostRole: 'guest', principal: null, workspace }),
    ).toBeNull();
    expect(
      predictOwnSenderAttribution({ hostRole: 'guest', principal, workspace: undefined }),
    ).toBeNull();
  });
});
