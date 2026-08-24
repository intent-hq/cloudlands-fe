import { describe, it, expect } from 'vitest';
import { Marked } from 'marked';
import { strikethroughDoubleTilde } from '../marked-strikethrough';
import { createTiptapTaskListMarked } from '../tiptap-task-list-extension';

/**
 * Mirrors the global-singleton configuration in MarkdownRenderer.svelte
 * (gfm + breaks + the strikethrough override spread into the same use call),
 * which also covers features/export/content-renderer.ts.
 */
function createGlobalLikeMarked() {
  const instance = new Marked();
  instance.use({
    breaks: true,
    gfm: true,
    ...strikethroughDoubleTilde,
  });
  return instance;
}

const REGRESSION_SENTENCE =
  'That gives us headroom (+~$130K over 10 months) but we should still plan a Phase 4 trim (~$300K, likely).';

const parsers: Array<[string, () => Marked]> = [
  ['createTiptapTaskListMarked (notes/worker pipeline)', () => createTiptapTaskListMarked()],
  ['global-marked config (chat/export pipeline)', () => createGlobalLikeMarked()],
];

describe.each(parsers)('double-tilde strikethrough via %s', (_name, factory) => {
  const parse = (markdown: string) => factory().parse(markdown) as string;

  it('does not strike a single-tilde wrapped word', () => {
    const html = parse('this is ~one~ word');
    expect(html).not.toContain('<del>');
    expect(html).not.toContain('<s>');
    expect(html).toContain('~one~');
  });

  it('does not strike across two incidental single tildes in prose', () => {
    const html = parse('costs ~$130K over 10 months and a trim ~$300K later');
    expect(html).not.toContain('<del>');
    expect(html).not.toContain('<s>');
    expect(html).toContain('~$130K');
    expect(html).toContain('~$300K');
  });

  it('does not strike the regression sentence from the bug report', () => {
    const html = parse(REGRESSION_SENTENCE);
    expect(html).not.toContain('<del>');
    expect(html).not.toContain('<s>');
    expect(html).toContain('~$130K');
    expect(html).toContain('~$300K');
  });

  it('does not fall back to the default single-tilde tokenizer (undefined, not false)', () => {
    // If the override returned `false` instead of `undefined`, marked would
    // fall back to the default GFM tokenizer and strike this span.
    const html = parse('~single~');
    expect(html).not.toContain('<del>');
    expect(html).not.toContain('<s>');
    expect(html).toContain('~single~');
  });

  it('still strikes double-tilde spans', () => {
    const html = parse('this is ~~struck~~ text');
    expect(html).toContain('<del>struck</del>');
  });

  it('still strikes double-tilde spans with nested inline marks', () => {
    const html = parse('~~**bold**~~');
    expect(html).toContain('<del><strong>bold</strong></del>');
  });

  it('does not treat triple tildes as strikethrough', () => {
    const html = parse('a ~~~three~~~ b');
    expect(html).not.toContain('<del>');
    expect(html).not.toContain('<s>');
  });
});
