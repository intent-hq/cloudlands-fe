// @vitest-environment node
// @ui-invariant
// Compiled-stylesheet counterpart of `css-has-invalidation-audit.test.ts`.
// The source ratchet cannot see what Tailwind emits: a `[body:has(.x)_&]:pr-8`
// candidate in any scanned file, or a `group-has-*` variant, only becomes a
// document-anchored or universal-subject `:has()` selector in the compiled
// CSS. This suite compiles `src/app.css` the way the production build does
// (Tailwind v4 via `@tailwindcss/postcss`, auto-detected sources rooted at the
// package directory) and audits every emitted rule selector.
import tailwindcss from '@tailwindcss/postcss';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { beforeAll, describe, expect, it } from 'vitest';
import { violatesHasInvalidation } from './css-has-invalidation-audit';

const packageRoot = process.cwd();
const appCss = path.resolve(packageRoot, 'src/app.css');

async function compile(css: string): Promise<string> {
  const result = await postcss([tailwindcss()]).process(css, { from: appCss });
  return result.css;
}

/** Every rule selector in compiled CSS, including rules nested in at-rules. */
function compiledSelectors(css: string): string[] {
  const selectors: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    selectors.push(...rule.selectors);
  });
  return selectors;
}

function auditCompiled(css: string): string[] {
  return compiledSelectors(css).filter(violatesHasInvalidation);
}

/** A stylesheet that compiles only the given utility candidates, no scanned sources. */
function candidateStylesheet(candidates: string[]): string {
  return [
    "@import 'tailwindcss' source(none);",
    '@custom-variant dark (&:where(.dark, .dark *));',
    ...candidates.map((candidate) => `@source inline("${candidate}");`),
  ].join('\n');
}

describe('compiled css :has() invalidation audit', () => {
  describe('compiler fixtures', () => {
    it.each([
      ['[body:has(.probe)_&]:pr-8', 'body:has(.probe)'],
      ['group-has-[open]:pr-8', ':where(.group):has(:is(open)) *'],
      ['[.foo:has(.bar)_:is(*,.baz)]:pr-8', ':is(.foo:has(.bar) :is(*, .baz))'],
      ['[.foo:has(.bar)_:where(*):hover]:pr-8', ':is(.foo:has(.bar) :where(*):hover)'],
      ['[&:is(body):has(.probe)]:pr-8', ':is(body):has(.probe)'],
      ['[.dark:root:has(.probe)_&]:pr-8', '.dark:root:has(.probe) '],
    ])('rejects the utility %s', async (candidate, emittedShape) => {
      const violations = auditCompiled(await compile(candidateStylesheet([candidate])));
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain(emittedShape);
    });

    it.each([['has-[>svg]:pl-2'], ['dark:pr-8'], ['[.x:not(body):has(.y)_&]:pr-8']])(
      'accepts the utility %s',
      async (candidate) => {
        const css = await compile(candidateStylesheet([candidate]));
        expect(compiledSelectors(css).some((s) => s.includes(':pl-2') || s.includes(':pr-8'))).toBe(
          true,
        );
        expect(auditCompiled(css)).toEqual([]);
      },
    );
  });

  describe('production stylesheet', () => {
    let compiled: string;

    beforeAll(async () => {
      // `$lib/` is a Vite alias; plain postcss resolves imports relative to `from`.
      const source = readFileSync(appCss, 'utf8').replaceAll("'$lib/", "'./lib/");
      compiled = await compile(source);
    });

    it('covers product sources', () => {
      expect(compiled).toContain('has-\\[\\>svg\\]\\:pl-2');
    });

    it('never anchors :has() at html, body, or :root and never gives :has() a universal subject', () => {
      expect(auditCompiled(compiled)).toEqual([]);
    });
  });
});
