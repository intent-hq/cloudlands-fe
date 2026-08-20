import { describe, expect, it } from 'vitest';
import { splitTextByUrls } from './message-link-utils';

describe('splitTextByUrls', () => {
  it('returns a single text part when there is no URL', () => {
    expect(splitTextByUrls('hello world')).toEqual([{ type: 'text', content: 'hello world' }]);
  });

  it('detects a URL mid-text', () => {
    expect(splitTextByUrls('support can go to https://www.intentapp.dev/docs for now')).toEqual([
      { type: 'text', content: 'support can go to ' },
      { type: 'link', url: 'https://www.intentapp.dev/docs' },
      { type: 'text', content: ' for now' },
    ]);
  });

  it('detects a URL at the end of text', () => {
    expect(splitTextByUrls('see https://example.com')).toEqual([
      { type: 'text', content: 'see ' },
      { type: 'link', url: 'https://example.com' },
    ]);
  });

  it('detects a URL at the start of text', () => {
    expect(splitTextByUrls('http://example.com is the site')).toEqual([
      { type: 'link', url: 'http://example.com' },
      { type: 'text', content: ' is the site' },
    ]);
  });

  it('excludes trailing punctuation from the URL', () => {
    expect(splitTextByUrls('go to https://example.com/docs.')).toEqual([
      { type: 'text', content: 'go to ' },
      { type: 'link', url: 'https://example.com/docs' },
      { type: 'text', content: '.' },
    ]);
    expect(splitTextByUrls('(see https://example.com/docs)')).toEqual([
      { type: 'text', content: '(see ' },
      { type: 'link', url: 'https://example.com/docs' },
      { type: 'text', content: ')' },
    ]);
    expect(splitTextByUrls('really? https://example.com!?')).toEqual([
      { type: 'text', content: 'really? ' },
      { type: 'link', url: 'https://example.com' },
      { type: 'text', content: '!?' },
    ]);
  });

  it('keeps balanced parentheses inside the URL', () => {
    expect(splitTextByUrls('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      { type: 'link', url: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
    ]);
  });

  it('detects multiple URLs', () => {
    expect(splitTextByUrls('a https://one.test b http://two.test c')).toEqual([
      { type: 'text', content: 'a ' },
      { type: 'link', url: 'https://one.test' },
      { type: 'text', content: ' b ' },
      { type: 'link', url: 'http://two.test' },
      { type: 'text', content: ' c' },
    ]);
  });

  it('detects intent:// URLs', () => {
    expect(splitTextByUrls('open intent://local/note/spec please')).toEqual([
      { type: 'text', content: 'open ' },
      { type: 'link', url: 'intent://local/note/spec' },
      { type: 'text', content: ' please' },
    ]);
  });

  it('does not linkify emails', () => {
    expect(splitTextByUrls('mail me at user@example.com thanks')).toEqual([
      { type: 'text', content: 'mail me at user@example.com thanks' },
    ]);
  });

  it('does not linkify bare TLD-like words', () => {
    expect(splitTextByUrls('check healthcheck.rs and intentapp.dev today')).toEqual([
      { type: 'text', content: 'check healthcheck.rs and intentapp.dev today' },
    ]);
  });

  it('does not linkify a bare protocol', () => {
    expect(splitTextByUrls('type https:// to start')).toEqual([
      { type: 'text', content: 'type https:// to start' },
    ]);
  });

  it('preserves whitespace and newlines so parts reassemble to the input', () => {
    const input = 'line one\n  https://example.com/a\n\nline two  ';
    const parts = splitTextByUrls(input);
    expect(parts.map((p) => (p.type === 'text' ? p.content : p.url)).join('')).toBe(input);
    expect(parts).toEqual([
      { type: 'text', content: 'line one\n  ' },
      { type: 'link', url: 'https://example.com/a' },
      { type: 'text', content: '\n\nline two  ' },
    ]);
  });
});
