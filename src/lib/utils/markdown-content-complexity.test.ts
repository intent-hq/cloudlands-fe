import { describe, expect, it } from 'vitest';
import { classifyMarkdownContent } from './markdown-content-complexity';

describe('markdown rendering strategy', () => {
  it.each([
    '',
    'Plain text\nwith another line',
    String.raw`Literal \$x$`,
    String.raw`Literal \\(x\\)`,
    'An unfinished $x',
    String.raw`An unfinished \(x`,
  ])('keeps unformatted content on the simple path: %s', (content) => {
    expect(classifyMarkdownContent(content)).toBe('simple');
  });

  it.each([
    // Detection is conservative; the parser keeps currency literal.
    'Costs $5 and $10',
    '$x^2$',
    String.raw`\(x^2\)`,
    '$$x^2$$',
    String.raw`\[x^2\]`,
    '$$unfinished',
    String.raw`\[unfinished`,
    '- [ ] open',
    '- [x] done',
    '```ts\nconst x = 1;\n```',
    '`code`',
    '| a | b |',
    '[link](https://example.com)',
    '![image](picture.png)',
    '<div>content</div>',
    '# Heading',
    '> quote',
    '**bold**',
    '*italic*',
    '_italic_',
    '~~removed~~',
    '---',
    '+ item',
    '1. item',
    '@note/spec',
    '@context[context-id]',
    '@/absolute/path',
    '@relative/file.custom',
    '@file.custom',
    '@auggie-personality-reviewer',
    'intent://local/note/spec',
    'Read package.json',
    'Read src/main.ts',
  ])('processes rich content consistently across repeated calls: %s', (content) => {
    expect(classifyMarkdownContent(content)).toBe('static');
    expect(classifyMarkdownContent('plain')).toBe('simple');
    expect(classifyMarkdownContent(content)).toBe('static');
  });
});
