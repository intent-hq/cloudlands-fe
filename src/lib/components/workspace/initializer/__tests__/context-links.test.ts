import { describe, expect, it } from 'vitest';
import { buildContextLinks, MAX_CONTEXT_LINKS, type ContextLinkMention } from '../context-links';

function issueMention(overrides: Partial<ContextLinkMention> = {}): ContextLinkMention {
  return {
    itemType: 'github-issue',
    provider: 'github',
    identifier: 'acme/widgets#7',
    url: 'https://github.com/acme/widgets/issues/7',
    ...overrides,
  };
}

describe('buildContextLinks', () => {
  it('returns undefined when no mentions qualify (param omitted on the wire)', () => {
    expect(buildContextLinks([])).toBeUndefined();
    expect(
      buildContextLinks([
        { itemType: 'linear-issue', provider: 'linear', identifier: 'ENG-1', url: 'https://x' },
        issueMention({ url: undefined }), // no URL
        issueMention({ identifier: 'not-parseable' }), // bad identifier
      ]),
    ).toBeUndefined();
  });

  it('maps a GitHub issue mention to an issue link', () => {
    expect(buildContextLinks([issueMention()])).toEqual([
      {
        kind: 'issue',
        url: 'https://github.com/acme/widgets/issues/7',
        owner: 'acme',
        repo: 'widgets',
        number: 7,
      },
    ]);
  });

  it('detects PR kind from the /pull/ URL even with itemType github-issue', () => {
    const links = buildContextLinks([
      issueMention({
        identifier: 'acme/widgets#42',
        url: 'https://github.com/acme/widgets/pull/42',
      }),
    ]);
    expect(links).toEqual([
      {
        kind: 'pr',
        url: 'https://github.com/acme/widgets/pull/42',
        owner: 'acme',
        repo: 'widgets',
        number: 42,
      },
    ]);
  });

  it('detects PR kind from the explicit github-pr itemType and from sourceBranch metadata', () => {
    const links = buildContextLinks([
      issueMention({ itemType: 'github-pr', identifier: 'acme/widgets#1', url: 'https://u/1' }),
      issueMention({
        identifier: 'acme/widgets#2',
        url: 'https://u/2',
        metadata: JSON.stringify({ sourceBranch: 'feat/x', targetBranch: 'main' }),
      }),
    ]);
    expect(links?.map((l) => l.kind)).toEqual(['pr', 'pr']);
  });

  it('falls back to issue kind on unparseable metadata', () => {
    const links = buildContextLinks([issueMention({ metadata: '{not json' })]);
    expect(links?.[0].kind).toBe('issue');
  });

  it('collapses duplicates and caps the list at the wire maximum', () => {
    const dupes = buildContextLinks([issueMention(), issueMention()]);
    expect(dupes).toHaveLength(1);

    const many = Array.from({ length: MAX_CONTEXT_LINKS + 5 }, (_, i) =>
      issueMention({
        identifier: `acme/widgets#${i + 1}`,
        url: `https://github.com/acme/widgets/issues/${i + 1}`,
      }),
    );
    expect(buildContextLinks(many)).toHaveLength(MAX_CONTEXT_LINKS);
  });

  it('skips non-github providers and mentions without provider', () => {
    expect(
      buildContextLinks([
        issueMention({ provider: 'sentry' }),
        issueMention({ provider: undefined }),
      ]),
    ).toBeUndefined();
  });
});
