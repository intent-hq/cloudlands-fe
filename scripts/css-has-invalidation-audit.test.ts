// @ui-invariant
// Blink shares one `:has()` invalidation set per anchor. A `:has()` anchored at
// `html`/`body`/`:root` turns every DOM or style mutation in the page into a
// candidate invalidation of that anchor, and a universal subject (`:has(…) *`,
// which is what Tailwind `group-has-*` / `peer-has-*` compile to) makes that
// invalidation restyle the whole subtree. Together they restyled the entire
// transcript on every disclosure-motion frame (events footer stutter).
//
// This is a source ratchet: it resolves authored stylesheet nesting (`&`,
// implicit descendants, at-rule wrappers) and scans Tailwind variant classes in
// markup. The compiled stylesheet is audited by
// `css-has-invalidation-built-audit.test.ts` with the same predicates.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { auditMarkup, auditStylesheet } from './css-has-invalidation-audit';

const root = path.resolve(process.cwd(), 'src');
const extensions = new Set(['.css', '.svelte', '.ts']);
const styleBlock = /<style[^>]*>([\s\S]*?)<\/style>/g;

function productFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name.startsWith('test-')) return [];
      return productFiles(file);
    }
    if (!extensions.has(path.extname(file)) || /\.(?:spec|test)\.ts$/.test(file)) return [];
    return [file];
  });
}

/** The `{ stylesheet, markup }` halves of a product file. */
function splitSource(file: string, source: string): { stylesheet: string; markup: string } {
  if (path.extname(file) === '.css') return { stylesheet: source, markup: '' };
  if (path.extname(file) !== '.svelte') return { stylesheet: '', markup: source };
  return {
    stylesheet: [...source.matchAll(styleBlock)].map((m) => m[1]).join('\n'),
    markup: source.replace(styleBlock, ' '),
  };
}

describe('css :has() invalidation audit', () => {
  describe('scanner fixtures', () => {
    it.each([
      [
        'a comment mentioning body:has()',
        '/* Avoid body:has(.dialog) to prevent invalidation. */\n.menu { color: red; }',
      ],
      ['a keyed anchor', '.dialog:has(.open) .menu { z-index: 1; }'],
      ['a body attribute marker without :has()', 'body[data-dialog-open] .menu { z-index: 1; }'],
      ['a keyed subject after :has()', '.foo:has(.bar) :is(.baz) { color: red; }'],
      ['a nested keyed rule under body', 'body { .dialog:has(.open) .menu { z-index: 1; } }'],
      ['a :has() nested under a keyed parent', '.shell { &:has(.open) .menu { z-index: 1; } }'],
      [
        'an at-rule around a keyed anchor',
        '@media (min-width: 40em) { .dialog:has(.open) { color: red; } }',
      ],
      [
        'a url containing double slashes',
        '.x { background: url(http://example.test/a.png); } .dialog:has(.open) { color: red; }',
      ],
    ])('accepts %s', (_label, css) => {
      expect(auditStylesheet(css)).toEqual([]);
    });

    it.each([
      ['a body anchor', 'body:has(.dialog) .menu { z-index: 1; }', 'body:has(.dialog) .menu'],
      [
        'an id-narrowed body anchor',
        'body#app:has(.dialog) .menu { z-index: 1; }',
        'body#app:has(.dialog) .menu',
      ],
      [
        'a class-narrowed :root anchor',
        ':root.dark:has(.dialog) { color: red; }',
        ':root.dark:has(.dialog)',
      ],
      [
        'an attribute-narrowed html anchor',
        'html[dir="rtl"]:has(.dialog) { color: red; }',
        'html[dir="rtl"]:has(.dialog)',
      ],
      [
        'a nested & anchor under body',
        'body { &:has(.dialog) .menu { z-index: 1; } }',
        'body:has(.dialog) .menu',
      ],
      [
        'a nested & anchor two levels down',
        'html { body { &:has(.dialog) { color: red; } } }',
        'html body:has(.dialog)',
      ],
      [
        'an at-rule around a body anchor',
        '@media (min-width: 40em) { body:has(.dialog) { color: red; } }',
        'body:has(.dialog)',
      ],
      [
        'a :global(body) anchor',
        ':global(body):has(.dialog) .menu { z-index: 1; }',
        ':global(body):has(.dialog) .menu',
      ],
      [
        'a :global(body:has()) anchor',
        ':global(body:has(.dialog)) .menu { z-index: 1; }',
        ':global(body:has(.dialog)) .menu',
      ],
      [
        'a :global block anchor',
        ':global { body:has(.dialog) .menu { z-index: 1; } }',
        ':global body:has(.dialog) .menu',
      ],
      [
        'an :is(body) anchor',
        ':is(body, .shell):has(.dialog) { color: red; }',
        ':is(body, .shell):has(.dialog)',
      ],
      [
        'one item of a selector list',
        '.ok, body:has(.dialog) { color: red; }',
        'body:has(.dialog)',
      ],
      ['a universal subject', '.foo:has(.bar) * { color: red; }', '.foo:has(.bar) *'],
      ['a child universal subject', '.foo:has(.bar) > * { color: red; }', '.foo:has(.bar) > *'],
      ['an :is(*) subject', '.foo:has(.bar) :is(*) { color: red; }', '.foo:has(.bar) :is(*)'],
      ['a nested universal subject', '.foo:has(.bar) { * { color: red; } }', '.foo:has(.bar) *'],
    ])('rejects %s', (_label, css, expected) => {
      expect(auditStylesheet(css)).toEqual([expected]);
    });

    it('scans Tailwind variant classes in markup after stripping comments', () => {
      expect(
        auditMarkup(
          '<!-- body:has(.x) is bad --><div class="[body:has(.x)_&]:pr-8 group-has-data-[sidebar=menu-action]/menu-item:pr-8"></div>',
        ),
      ).toEqual(['[body:has(', 'group-has-data-[sidebar=menu-action]/menu-item:pr-8']);
      expect(auditMarkup('<div class="has-data-[open]:pr-8"></div>')).toEqual([]);
    });
  });

  const files = productFiles(root);

  it('never anchors :has() at html, body, or :root and never gives :has() a universal subject', () => {
    const violations = files.flatMap((file) => {
      const relative = path.relative(process.cwd(), file);
      const { stylesheet, markup } = splitSource(file, readFileSync(file, 'utf8'));
      return [...auditStylesheet(stylesheet), ...auditMarkup(markup)].map(
        (s) => `${relative}: ${s}`,
      );
    });

    expect(violations).toEqual([]);
  });
});
