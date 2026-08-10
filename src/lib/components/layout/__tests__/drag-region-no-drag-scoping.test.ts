/**
 * Regression coverage for intent-hq/monorepo#1907 — titlebar drag-region dead
 * zone. Chromium computes draggable regions from UNCLIPPED element geometry
 * (ancestor overflow clipping / scroll offsets are ignored), so an app-wide
 * `-webkit-app-region: no-drag` rule on all interactive elements let chat
 * content scrolled under the titlebar carve holes in the titlebar drag region.
 *
 * The rule in src/routes/+layout.svelte must therefore be scoped to
 * interactive elements INSIDE drag regions (`.app-drag-region` descendants) —
 * never app-wide. jsdom does not compute webkitAppRegion, so this suite
 * asserts the selector/structure invariant instead: the extracted no-drag
 * selectors match interactive elements inside a drag-region container and do
 * NOT match the same elements outside one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (relativeToSrc: string) => readFileSync(resolve(srcDir, relativeToSrc), 'utf8');

const layoutSource = read('routes/+layout.svelte');

/** Selectors of the no-drag rule in +layout.svelte, unwrapped from :global(). */
function extractNoDragSelectors(source: string): string[] {
  const style = source.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '';
  const css = style.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/-webkit-app-region:\s*no-drag/.test(match[2])) continue;
    for (const raw of match[1].split(',')) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const unwrapped = trimmed.match(/^:global\(([\s\S]*)\)$/)?.[1] ?? trimmed;
      selectors.push(unwrapped.trim());
    }
  }
  return selectors;
}

const noDragSelectors = extractNoDragSelectors(layoutSource);
const matchesNoDragRule = (el: Element) => noDragSelectors.some((sel) => el.matches(sel));

describe('no-drag rule scoping (+layout.svelte)', () => {
  it('extracts a non-empty no-drag selector list', () => {
    expect(noDragSelectors.length).toBeGreaterThan(0);
  });

  it('scopes every no-drag selector under .app-drag-region — never app-wide', () => {
    for (const sel of noDragSelectors) {
      expect(sel, `selector "${sel}" must be scoped to a drag region`).toMatch(
        /^\.app-drag-region\s/,
      );
    }
  });

  it('marks interactive elements inside a drag region as no-drag', () => {
    document.body.innerHTML = `
      <div class="app-drag-region">
        <button id="btn">b</button>
        <a href="#top" id="link">a</a>
        <input id="input" />
        <div role="button" id="roleBtn">r</div>
        <div data-interactive id="dataInteractive">d</div>
        <div tabindex="0" id="focusable">f</div>
      </div>`;
    for (const id of ['btn', 'link', 'input', 'roleBtn', 'dataInteractive', 'focusable']) {
      const el = document.getElementById(id)!;
      expect(matchesNoDragRule(el), `#${id} inside drag region must be no-drag`).toBe(true);
    }
    // tabindex="-1" is not user-interactive — stays draggable even inside.
    document.body.innerHTML = `<div class="app-drag-region"><div tabindex="-1" id="ni"></div></div>`;
    expect(matchesNoDragRule(document.getElementById('ni')!)).toBe(false);
  });

  it('does NOT mark the same interactive elements outside a drag region (#1907)', () => {
    // Mirrors the confirmed root cause: a ResponseGroup collapsed-group header
    // button in scrolled chat content. It must no longer have computed
    // no-drag, or scrolling it under the titlebar carves a drag-region hole.
    document.body.innerHTML = `
      <div class="panel-content">
        <button id="btn" class="flex items-center gap-2.5 w-full py-1 px-1">group header</button>
        <a href="#top" id="link">a</a>
        <input id="input" />
        <div role="button" id="roleBtn">r</div>
        <div tabindex="0" id="focusable">f</div>
      </div>`;
    for (const id of ['btn', 'link', 'input', 'roleBtn', 'focusable']) {
      const el = document.getElementById(id)!;
      expect(matchesNoDragRule(el), `#${id} outside drag region must NOT be no-drag`).toBe(false);
    }
  });
});

describe('drag surfaces carry the .app-drag-region scope class', () => {
  it('WindowTitleBar drag surface is an app-drag-region', () => {
    const source = read('lib/components/layout/WindowTitleBar.svelte');
    expect(source).toContain("'window-title-bar app-drag-region'");
  });

  it('HudHeader drag surface is an app-drag-region', () => {
    const source = read('features/hud/components/HudHeader.svelte');
    expect(source).toContain('class="hud-header app-drag-region"');
  });

  it('update indicator overlaying the titlebar keeps an explicit no-drag', () => {
    // It sits over the titlebar drag strip but outside any .app-drag-region
    // subtree, so it opts into no-drag inline (tooltip hover would otherwise
    // be swallowed by the drag region).
    const wrapper = layoutSource.match(/<div[^>]*>\s*<UpdateDownloadIndicator \/>/)?.[0] ?? '';
    expect(wrapper).toContain('-webkit-app-region: no-drag');
  });
});
