/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { toPromptToken } from './format';
import type { MentionCandidate } from './types';
import { plainTextToEditorHTML } from '$lib/components/chat/input/editor-text-serialization';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { injectMentionSpans } from '$lib/utils/markdown-mention-injector';
import { classifyMarkdownContent } from '$lib/utils/markdown-content-complexity';
import { findInlineMentions } from '$lib/components/chat/mention-match-utils';
import { parseMemberMention, memberMentionsToText } from '$lib/utils/member-mention-token';
import { stripUserMessagePrefixes } from '$lib/utils/text-utils';

const member: MentionCandidate = {
  id: 'member-gitlab-person',
  type: 'member',
  label: 'alice.dev_ops-team',
  uri: 'devspace://member/gitlab-person?workspaceId=shared-workspace',
  meta: {
    principalId: 'gitlab-person',
    workspaceId: 'shared-workspace',
    identity: { provider: 'gitlab', host: 'code.example:8443', externalUserId: '42' },
  },
};

function documentFor(html: string): HTMLElement {
  const result = document.createElement('div');
  result.innerHTML = html;
  return result;
}

describe('member mention text persistence', () => {
  it('uses readable handles in plain-text previews without changing the stored token', () => {
    const token = toPromptToken(member);
    expect(memberMentionsToText(`Please ${token} review`)).toBe(
      'Please @alice.dev_ops-team review',
    );
    expect(stripUserMessagePrefixes(`[Current view] ${token} please`)).toBe(
      '@alice.dev_ops-team please',
    );
    expect(parseMemberMention(token)?.meta).toEqual(member.meta);
  });

  it('rejects malformed data instead of guessing a member or treating it as a file', async () => {
    const encoded = (value: unknown) => `@member[${btoa(JSON.stringify(value))}]`;
    for (const token of [
      '@member[invalid]',
      '@member[]',
      encoded(null),
      encoded([]),
      encoded({ label: 'alice.dev', principalId: 'p' }),
      encoded({
        label: 'alice.dev',
        principalId: 'p',
        workspaceId: 'w',
        identity: { provider: 'gitlab' },
      }),
      encoded({
        label: 'alice.dev',
        principalId: 'p',
        workspaceId: 'w',
        identity: { provider: 'unknown', host: 'example.com', externalUserId: '1' },
      }),
    ]) {
      expect(parseMemberMention(token)).toBeNull();
      const restored = documentFor(plainTextToEditorHTML(token));
      expect(restored.querySelector('[data-mention]')).toBeNull();
      expect(restored.textContent).toBe(token);
      expect(
        documentFor(await processMarkdownToHTML(token)).querySelector('[data-mention]'),
      ).toBeNull();
    }
  });

  it('keeps dotted handles and their principal, workspace, and forge when restoring a draft', () => {
    const token = toPromptToken(member);
    const restored = documentFor(plainTextToEditorHTML(`Ask ${token} please`));
    const chip = restored.querySelector('[data-type="member"]');
    expect(chip?.textContent).toBe('@alice.dev_ops-team');
    expect(chip?.getAttribute('data-id')).toBe('member-gitlab-person');
    expect(chip?.getAttribute('data-uri')).toBe(member.uri);
    expect(JSON.parse(chip!.getAttribute('data-meta')!)).toEqual(member.meta);
    expect(restored.querySelector('[data-type="file"]')).toBeNull();
    expect(restored.textContent).toBe('Ask @alice.dev_ops-team please');
  });

  it('distinguishes equal handles on different providers and hosts after saving', () => {
    const others: MentionCandidate[] = [
      member,
      {
        ...member,
        id: 'member-github-person',
        meta: {
          ...member.meta,
          principalId: 'github-person',
          identity: { provider: 'github', host: 'github.com', externalUserId: '42' },
        },
      },
      {
        ...member,
        id: 'member-other-gitlab',
        meta: {
          ...member.meta,
          principalId: 'other-gitlab',
          identity: { provider: 'gitlab', host: 'gitlab.com', externalUserId: '42' },
        },
      },
    ];
    const tokens = others.map(toPromptToken);
    expect(new Set(tokens).size).toBe(3);
    const restored = documentFor(plainTextToEditorHTML(tokens.join(' ')));
    const identities = [...restored.querySelectorAll('[data-type="member"]')].map((chip) =>
      JSON.parse(chip.getAttribute('data-meta')!),
    );
    expect(identities).toEqual(others.map((item) => item.meta));
  });

  it('does not invent a forge identity for older members without metadata', () => {
    const token = toPromptToken({
      ...member,
      meta: { principalId: 'legacy', workspaceId: 'shared-workspace' },
    });
    const restored = documentFor(plainTextToEditorHTML(token));
    const chip = restored.querySelector('[data-type="member"]');
    expect(JSON.parse(chip!.getAttribute('data-meta')!)).toEqual({
      principalId: 'legacy',
      workspaceId: 'shared-workspace',
    });
    expect(restored.textContent).toBe('@alice.dev_ops-team');
  });

  it('renders saved mentions readably through both markdown pipelines and comment editing', async () => {
    const token = toPromptToken(member);
    const markdown = `Please ${token} review this`;
    const html = await processMarkdownToHTML(markdown);
    for (const rendered of [html, injectMentionSpans(`<p>${markdown}</p>`)]) {
      const result = documentFor(rendered);
      expect(result.textContent?.trim()).toBe('Please @alice.dev_ops-team review this');
      expect(result.querySelectorAll('[data-type="member"]')).toHaveLength(1);
      expect(result.querySelector('[data-type="file"]')).toBeNull();
    }
    expect(processHTMLToMarkdown(html)).toBe(markdown);
    expect(classifyMarkdownContent(token)).toBe('static');
    expect(findInlineMentions(`Ask (${token}), please`)).toEqual([
      { index: 5, fullMatch: token, captured: token.slice(1) },
    ]);
  });

  it('escapes member labels and keeps surrounding files, notes and context mentions independent', () => {
    const token = toPromptToken({ ...member, label: 'dev<"&é' });
    const restored = documentFor(
      plainTextToEditorHTML(`${token} @README.md @note/spec @context[linear|ENG-1|Fix]`),
    );
    expect(restored.querySelector('[data-type="member"]')?.textContent).toBe('@dev<"&é');
    expect(restored.querySelectorAll('[data-type="file"]')).toHaveLength(1);
    expect(restored.querySelector('[data-type="note"]')?.getAttribute('data-id')).toBe('spec');
    expect(
      restored.querySelector('[data-type="context-mention"]')?.getAttribute('data-identifier'),
    ).toBe('ENG-1');
    expect(restored.querySelector('script')).toBeNull();
  });
});
