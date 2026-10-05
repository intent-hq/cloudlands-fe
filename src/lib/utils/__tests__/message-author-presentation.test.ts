import { describe, expect, it } from 'vitest';
import type { MessageAuthor } from '$shared/types/agent-message';
import {
  getMessageAuthorLabel,
  getMessageAuthorTooltip,
  getHumanMessageAuthor,
  getQueuedMessageAuthor,
} from '../message-authorship';

const profile: MessageAuthor = {
  principalId: 'principal-secret',
  login: 'octocat',
  displayName: 'The Octocat',
  avatarUrl: null,
};

describe('readable chat author presentation', () => {
  for (const identity of [
    undefined,
    { provider: 'github' as const, host: 'github.com', externalUserId: '526899' },
    { provider: 'gitlab' as const, host: 'gitlab.com', externalUserId: '526899' },
    { provider: 'gitlab' as const, host: 'forge.example:8443', externalUserId: '526899' },
  ]) {
    for (const principalId of ['principal-secret', null]) {
      it(`uses only own profile fields for ${identity?.host ?? 'local'} / ${principalId}`, () => {
        const author = { ...profile, principalId, identity };
        expect(getMessageAuthorLabel(author)).toBe('The Octocat · @octocat');
        expect(getMessageAuthorLabel({ ...author, displayName: null })).toBe('@octocat');
        expect(getMessageAuthorLabel({ ...author, login: null })).toBe('The Octocat');
        expect(getMessageAuthorLabel({ ...author, login: ' ', displayName: '\t' })).toBeNull();
        expect(getMessageAuthorTooltip({ ...author, login: null, displayName: null })).not.toMatch(
          /526899|principal-secret|@/,
        );
        const row = {
          role: 'user' as const,
          author,
          metadata: { fromPrincipalId: 'principal-secret' },
        };
        const before = JSON.stringify(row);
        const transcript = getHumanMessageAuthor(row, 'viewer');
        const queue = getQueuedMessageAuthor(
          { author, messageMetadata: row.metadata },
          new Map(),
          'viewer',
        );
        expect(queue).toEqual(transcript);
        expect(getMessageAuthorLabel(queue!)).toBe(getMessageAuthorLabel(transcript!));
        expect(JSON.stringify(row)).toBe(before);
      });
    }
  }
  it('keeps equal handles on different hosts separate for identity based actions', () => {
    const authors = ['one.example', 'two.example'].map((host, i) => ({
      ...profile,
      principalId: `person-${i}`,
      identity: { provider: 'gitlab' as const, host, externalUserId: '42' },
    }));
    expect(authors.map(getMessageAuthorLabel)).toEqual([
      'The Octocat · @octocat',
      'The Octocat · @octocat',
    ]);
    expect(getHumanMessageAuthor({ role: 'user', author: authors[0] }, 'person-0')).toBeNull();
    expect(
      getHumanMessageAuthor({ role: 'user', author: authors[1] }, 'person-0')?.principalId,
    ).toBe('person-1');
  });
});
