import { describe, expect, it } from 'vitest';
import { canonicalInviteHost } from './invite-pin';
import { isWorkspaceGuest } from './workspace-guest';
describe('independent invitation pins', () => {
  it('uses provider defaults and preserves a canonical explicit instance port', () => {
    expect(canonicalInviteHost('github', '')).toBe('github.com');
    expect(canonicalInviteHost('gitlab', '')).toBe('gitlab.com');
    expect(canonicalInviteHost('gitlab', ' Forge.Example:8443 ')).toBe('forge.example:8443');
  });
  it.each([
    'https://forge.test',
    'user@forge.test',
    'forge.test/path',
    'forge.test?x',
    'forge.test#x',
    'forge.test:99999',
    'bad host',
  ])('rejects non-authority %s', (host) => {
    expect(canonicalInviteHost('gitlab', host)).toBeNull();
  });
  it('rejects other GitHub instances', () =>
    expect(canonicalInviteHost('github', 'forge.test')).toBeNull());
  it('effective host membership wins over retained collaborator rows; legacy guests remain', () => {
    expect(isWorkspaceGuest({ role: 'collaborator', hostRole: 'member' })).toBe(false);
    expect(isWorkspaceGuest({ role: 'collaborator', hostRole: 'owner' })).toBe(false);
    expect(isWorkspaceGuest({ role: 'owner', hostRole: 'guest' })).toBe(false);
    expect(isWorkspaceGuest({ role: 'collaborator', hostRole: 'guest' })).toBe(true);
    expect(isWorkspaceGuest({ role: 'collaborator' })).toBe(true);
  });
});
