// @ui-invariant
// Blink shares one `:has()` invalidation set per anchor. A `:has()` anchored at
// `html`/`body`/`:root` turns every DOM or style mutation in the page into a
// candidate invalidation of that anchor, and a universal subject (`:has(…) *`,
// which is what Tailwind `group-has-*` / `peer-has-*` compile to) makes that
// invalidation restyle the whole subtree. Together they restyled the entire
// transcript on every disclosure-motion frame (events footer stutter).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'src');
const extensions = new Set(['.css', '.svelte', '.ts']);
const documentAnchoredHas =
  /(?:^|[\s>+~,({])(?::global\()?(?:html|body|:root)(?:\.[\w-]+|\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*:has\(/g;
const universalSubjectVariant = /(?:^|[\s'"`])((?:group|peer)-has(?:-[^\s'"`]*)?:[^\s'"`]+)/g;

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

function stylesheetText(file: string, source: string): string {
  if (path.extname(file) === '.css') return source;
  if (path.extname(file) !== '.svelte') return '';
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

function closingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** Selectors whose subject after a `:has()` is the universal selector. */
function universalSubjectHas(css: string): string[] {
  const found: string[] = [];
  for (const match of css.matchAll(/:has\(/g)) {
    const open = match.index + ':has'.length;
    const close = closingParen(css, open);
    if (close === -1) continue;
    const rest = css.slice(close + 1);
    const end = rest.search(/[{,]/);
    const tail = (end === -1 ? rest : rest.slice(0, end)).replace(/\)+\s*$/, '').trim();
    if (/(?:^|[\s>+~])\*$/.test(tail)) {
      const start = css.lastIndexOf('\n', match.index) + 1;
      found.push(css.slice(start, close + 1 + (end === -1 ? rest.length : end)).trim());
    }
  }
  return found;
}

describe('css :has() invalidation audit', () => {
  const files = productFiles(root);

  it('never anchors :has() at html, body, or :root', () => {
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(documentAnchoredHas)].map(
        (match) => `${path.relative(process.cwd(), file)}: ${match[0].trim()}`,
      );
    });

    expect(violations).toEqual([]);
  });

  it('never gives a :has() selector a universal subject', () => {
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const relative = path.relative(process.cwd(), file);
      return [
        ...universalSubjectHas(stylesheetText(file, source)).map((s) => `${relative}: ${s}`),
        ...[...source.matchAll(universalSubjectVariant)].map((m) => `${relative}: ${m[1]}`),
      ];
    });

    expect(violations).toEqual([]);
  });
});
