// @ui-invariant
// Blink shares one `:has()` invalidation set per anchor. A `:has()` anchored at
// `html`/`body`/`:root` turns every DOM or style mutation in the page into a
// candidate invalidation of that anchor, and a universal subject (`:has(…) *`,
// which is what Tailwind `group-has-*` / `peer-has-*` compile to) makes that
// invalidation restyle the whole subtree. Together they restyled the entire
// transcript on every disclosure-motion frame (events footer stutter).
//
// This is a source ratchet, not a built-CSS audit: it resolves authored
// stylesheet nesting (`&`, implicit descendants, at-rule wrappers) and scans
// Tailwind variant classes in markup, but does not compile Tailwind utilities.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'src');
const extensions = new Set(['.css', '.svelte', '.ts']);
const compoundSuffix = String.raw`(?:#[\w-]+|\.[\w-]+|\[[^\]]*\]|:(?!has\b)[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?)*`;
const documentCompound = new RegExp(String.raw`^(?:html|body|:root)${compoundSuffix}$`);
const wrappedCompound = /^:(?:is|where|global)\(/;
const universalCompound = /^\*(?::(?!has\b)[\w-]+(?:\([^()]*\))?)*$|^:(?:is|where)\(\s*\*\s*\)$/;
const documentAnchoredHasInMarkup = new RegExp(
  String.raw`(?:^|[\s>+~,({\['"\x60])(?::global\()?(?:html|body|:root)${compoundSuffix}:has\(`,
  'g',
);
const universalSubjectVariant = /(?:^|[\s'"`])((?:group|peer)-has(?:-[^\s'"`]*)?:[^\s'"`]+)/g;
const styleBlock = /<style[^>]*>([\s\S]*?)<\/style>/g;

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The compound selector that ends right before `index` (stops at combinators or an enclosing `(`). */
function compoundBefore(selector: string, index: number): string {
  let depth = 0;
  let i = index - 1;
  for (; i >= 0; i--) {
    const ch = selector[i];
    if (ch === ')' || ch === ']') depth++;
    else if (ch === '(' || ch === '[') {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && /[\s>+~,]/.test(ch)) break;
  }
  return selector.slice(i + 1, index);
}

function isDocumentCompound(compound: string): boolean {
  if (documentCompound.test(compound)) return true;
  if (!wrappedCompound.test(compound)) return false;
  const open = compound.indexOf('(');
  const close = closingParen(compound, open);
  if (close === -1) return false;
  return splitTopLevel(compound.slice(open + 1, close), ',').some(isDocumentCompound);
}

function resolveNested(selectors: string[], parents: string[]): string[] {
  if (parents.length === 0) return selectors;
  return selectors.flatMap((selector) =>
    parents.map((parent) =>
      selector.includes('&') ? selector.replaceAll('&', parent) : `${parent} ${selector}`,
    ),
  );
}

/** Every fully resolved style-rule selector in a (possibly nested) stylesheet. */
function stylesheetSelectors(css: string): string[] {
  const selectors: string[] = [];
  const scopes: string[][] = [];
  let buffer = '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === quote && css[i - 1] !== '\\') quote = null;
      buffer += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && ch === '{') {
      const prelude = buffer.trim();
      buffer = '';
      const parents = scopes.at(-1) ?? [];
      if (prelude.startsWith('@')) {
        scopes.push(parents);
      } else {
        const own = resolveNested(splitTopLevel(prelude, ','), parents);
        selectors.push(...own);
        scopes.push(own);
      }
      continue;
    }
    if (depth === 0 && (ch === '}' || ch === ';')) {
      buffer = '';
      if (ch === '}') scopes.pop();
      continue;
    }
    buffer += ch;
  }
  return selectors;
}

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

function closingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** `:has()` whose anchor compound is `html`, `body`, or `:root` (optionally narrowed by id/class/attribute/pseudo). */
function anchorsHasAtDocument(selector: string): boolean {
  return [...selector.matchAll(/:has\(/g)].some((match) =>
    isDocumentCompound(compoundBefore(selector, match.index)),
  );
}

/** A `:has()` somewhere before a universal subject (`*`, `:is(*)`, `:where(*)`). */
function hasUniversalSubject(selector: string): boolean {
  const trimmed = selector.trimEnd();
  const subject = compoundBefore(trimmed, trimmed.length);
  return universalCompound.test(subject) && trimmed.slice(0, -subject.length).includes(':has(');
}

function auditStylesheet(css: string): string[] {
  return stylesheetSelectors(stripComments(css)).filter(
    (selector) => anchorsHasAtDocument(selector) || hasUniversalSubject(selector),
  );
}

function auditMarkup(markup: string): string[] {
  const text = stripComments(markup);
  return [
    ...[...text.matchAll(documentAnchoredHasInMarkup)].map((m) => m[0].trim()),
    ...[...text.matchAll(universalSubjectVariant)].map((m) => m[1]),
  ];
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
