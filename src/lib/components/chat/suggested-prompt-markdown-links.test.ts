import { describe, expect, it } from 'vitest';
import {
  promptVisibleText,
  splitPromptMarkdownLinks,
  type PromptMarkdownLinkPart,
} from './suggested-prompt-markdown-links';

const PR_URL = 'https://github.com/intent-hq/intent/pull/5034';

function rebuild(parts: PromptMarkdownLinkPart[]): string {
  return parts
    .map((part) => (part.type === 'link' ? `[${part.label}](${part.url})` : part.content))
    .join('');
}

describe('splitPromptMarkdownLinks', () => {
  it('returns a single text part when there is no link', () => {
    expect(splitPromptMarkdownLinks('Run the tests')).toEqual([
      { type: 'text', content: 'Run the tests' },
    ]);
  });

  it('returns no parts for an empty prompt', () => {
    expect(splitPromptMarkdownLinks('')).toEqual([]);
  });

  it('splits a single link mid-text', () => {
    expect(splitPromptMarkdownLinks(`Approve the [#5034](${PR_URL}) diagnostic.`)).toEqual([
      { type: 'text', content: 'Approve the ' },
      { type: 'link', label: '#5034', url: PR_URL },
      { type: 'text', content: ' diagnostic.' },
    ]);
  });

  it('splits multiple links', () => {
    const prompt = `Merge [#1](https://a.test/1) then [#2](https://a.test/2) and [note](intent://local/note/spec)`;
    expect(splitPromptMarkdownLinks(prompt)).toEqual([
      { type: 'text', content: 'Merge ' },
      { type: 'link', label: '#1', url: 'https://a.test/1' },
      { type: 'text', content: ' then ' },
      { type: 'link', label: '#2', url: 'https://a.test/2' },
      { type: 'text', content: ' and ' },
      { type: 'link', label: 'note', url: 'intent://local/note/spec' },
    ]);
  });

  it('handles a link at the start and at the end', () => {
    expect(splitPromptMarkdownLinks(`[#5034](${PR_URL}) needs review`)).toEqual([
      { type: 'link', label: '#5034', url: PR_URL },
      { type: 'text', content: ' needs review' },
    ]);
    expect(splitPromptMarkdownLinks(`Review [#5034](${PR_URL})`)).toEqual([
      { type: 'text', content: 'Review ' },
      { type: 'link', label: '#5034', url: PR_URL },
    ]);
  });

  it('keeps adjacent punctuation as text', () => {
    expect(splitPromptMarkdownLinks(`Close [#5008](${PR_URL}).`)).toEqual([
      { type: 'text', content: 'Close ' },
      { type: 'link', label: '#5008', url: PR_URL },
      { type: 'text', content: '.' },
    ]);
    expect(splitPromptMarkdownLinks(`(see [#5008](${PR_URL}))`)).toEqual([
      { type: 'text', content: '(see ' },
      { type: 'link', label: '#5008', url: PR_URL },
      { type: 'text', content: ')' },
    ]);
  });

  it('accepts http:// and is case-insensitive on the scheme', () => {
    expect(splitPromptMarkdownLinks('[a](HTTP://a.test) [b](http://b.test)')).toEqual([
      { type: 'link', label: 'a', url: 'HTTP://a.test' },
      { type: 'text', content: ' ' },
      { type: 'link', label: 'b', url: 'http://b.test' },
    ]);
  });

  it('keeps one level of balanced parentheses inside the destination', () => {
    const url = 'https://en.wikipedia.org/wiki/Foo_(bar)';
    expect(splitPromptMarkdownLinks(`Read [Foo](${url}) now`)).toEqual([
      { type: 'text', content: 'Read ' },
      { type: 'link', label: 'Foo', url },
      { type: 'text', content: ' now' },
    ]);
  });

  it.each([
    ['non-http scheme', '[ftp](ftp://a.test/file)'],
    ['mailto scheme', '[mail](mailto:a@b.test)'],
    ['javascript scheme', '[x](javascript:alert(1))'],
    ['relative destination', '[readme](docs/README.md)'],
    ['image syntax', '![alt](https://a.test/img.png)'],
    ['empty label', '[](https://a.test)'],
    ['whitespace-only label', '[ ](https://a.test)'],
    ['reference-style link', '[label][ref] and [label]'],
    ['unbalanced opening bracket', '[label(https://a.test)'],
    ['unbalanced closing paren', '[label](https://a.test'],
    ['nested brackets in label', '[[label]](https://a.test)'],
    ['space between ] and (', '[label] (https://a.test)'],
    ['whitespace inside destination', '[label](https://a.test/a b)'],
    ['bare URL', 'See https://a.test/pull/1 please'],
    ['bare #N', 'Approve #5034 now'],
  ])('leaves %s literal', (_name, prompt) => {
    expect(splitPromptMarkdownLinks(prompt)).toEqual([{ type: 'text', content: prompt }]);
  });

  it('still links a valid link that follows rejected syntax', () => {
    expect(splitPromptMarkdownLinks('![i](https://a.test/i.png) [ok](https://a.test)')).toEqual([
      { type: 'text', content: '![i](https://a.test/i.png) ' },
      { type: 'link', label: 'ok', url: 'https://a.test' },
    ]);
  });

  it.each([
    'plain text',
    `Approve the [#5034](${PR_URL}) diagnostic.`,
    `[a](https://a.test)[b](https://b.test)`,
    `![img](https://a.test/i.png) and [x](javascript:alert(1)) and [ok](${PR_URL}).`,
    `Read [Foo](https://en.wikipedia.org/wiki/Foo_(bar)) now`,
  ])('round-trips %s', (prompt) => {
    expect(rebuild(splitPromptMarkdownLinks(prompt))).toBe(prompt);
  });
});

describe('promptVisibleText', () => {
  it('substitutes labels for links and leaves other text untouched', () => {
    expect(promptVisibleText(`Approve the [#5034](${PR_URL}) diagnostic.`)).toBe(
      'Approve the #5034 diagnostic.',
    );
  });

  it('returns literal syntax unchanged', () => {
    const prompt = '![alt](https://a.test/img.png) and [x](javascript:alert(1))';
    expect(promptVisibleText(prompt)).toBe(prompt);
  });

  it('is much shorter than the raw markdown for link-heavy prompts', () => {
    const prompt = `Merge [#1](${PR_URL}), [#2](${PR_URL}) and [#3](${PR_URL}).`;
    expect(promptVisibleText(prompt)).toBe('Merge #1, #2 and #3.');
    expect(prompt.length).toBeGreaterThan(150);
  });
});
