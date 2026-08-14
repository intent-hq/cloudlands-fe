/**
 * Regression coverage for intent-hq/monorepo#1907 — titlebar drag-region dead
 * zone. Chromium computes draggable regions from UNCLIPPED element geometry
 * (ancestor overflow clipping / scroll offsets are ignored), so an app-wide
 * `-webkit-app-region: no-drag` rule on all interactive elements let chat
 * content scrolled under the titlebar carve holes in the titlebar drag region.
 *
 * The rule in src/app.css must therefore be scoped to interactive elements
 * INSIDE drag regions (`.app-drag-region` descendants) — never app-wide.
 * jsdom does not compute webkitAppRegion, so this suite asserts the
 * selector/structure invariant instead: the extracted no-drag selectors match
 * interactive elements inside a drag-region container and do NOT match the
 * same elements outside one.
 *
 * Also covers intent-hq/monorepo#2167: the rule must ship in CSS loaded by
 * EVERY window (src/app.css via the root layout), not only in the (app) route
 * group — the standalone /hud window is outside (app), and scoping the rule to
 * (app) left every interactive child of the HUD header draggable.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (relativeToSrc: string) => readFileSync(resolve(srcDir, relativeToSrc), 'utf8');

const appLayoutSource = read('routes/(app)/+layout.svelte');
const appLayoutCss = read('routes/(app)/app-layout.css');
const rootLayoutSource = read('routes/+layout.svelte');
const globalCss = read('app.css');

/** Selectors of app-region rules with the given value, unwrapped from :global(). */
function extractAppRegionSelectors(source: string, value: string): string[] {
  const style = source.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '';
  const css = style.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!new RegExp(`-webkit-app-region:\\s*${value}`).test(match[2])) continue;
    for (const raw of match[1].split(',')) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const unwrapped = trimmed.match(/^:global\(([\s\S]*)\)$/)?.[1] ?? trimmed;
      selectors.push(unwrapped.trim());
    }
  }
  return selectors;
}

const extractNoDragSelectors = (source: string) => extractAppRegionSelectors(source, 'no-drag');

const CLIP_CONTAINER = '.app-drag-region [data-app-region-clip]';
const noDragSelectors = extractNoDragSelectors(`<style>${globalCss}</style>`).filter(
  (selector) => selector !== '.app-no-drag' && selector !== CLIP_CONTAINER,
);
const resetSelectors = extractAppRegionSelectors(`<style>${globalCss}</style>`, 'initial');
const matchesNoDragRule = (el: Element) => noDragSelectors.some((sel) => el.matches(sel));

describe('no-drag rule scoping (app.css)', () => {
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
    const wrapper = appLayoutSource.match(/<div[^>]*>\s*<UpdateDownloadIndicator \/>/)?.[0] ?? '';
    expect(wrapper).toContain('app-no-drag');
    expect(globalCss).toMatch(/\.app-no-drag\s*\{[^}]*-webkit-app-region:\s*no-drag/s);
  });
});

describe('scroll-container app-region clipping (#2400)', () => {
  // Chromium computes draggable regions from UNCLIPPED geometry, so tabs
  // scrolled out of the WorkspaceTabStrip scroll container carved no-drag
  // holes over the titlebar gap left of the tabs. The fix: the container
  // itself is no-drag (its border box is exactly its visible area) and its
  // interactive descendants reset to `initial` so their unclipped rects
  // contribute nothing.

  it('marks the clip container itself as no-drag', () => {
    const allNoDrag = extractNoDragSelectors(`<style>${globalCss}</style>`);
    expect(allNoDrag).toContain(CLIP_CONTAINER);
  });

  it('resets every interactive-element no-drag selector inside the clip container', () => {
    // The reset list must mirror the scoped no-drag list one-to-one, so a
    // selector added to the no-drag rule cannot silently reintroduce carving.
    const expected = noDragSelectors.map((sel) =>
      sel.replace(/^\.app-drag-region\s/, `${CLIP_CONTAINER} `),
    );
    expect(resetSelectors.sort()).toEqual(expected.sort());
  });

  it('interactive elements inside the clip container match a reset selector', () => {
    document.body.innerHTML = `
      <div class="app-drag-region">
        <div data-app-region-clip>
          <button id="btn">b</button>
          <div role="tab" id="tab">t</div>
          <div tabindex="0" id="focusable">f</div>
        </div>
      </div>`;
    for (const id of ['btn', 'tab', 'focusable']) {
      const el = document.getElementById(id)!;
      // Still matched by the scoped no-drag rule (lower in cascade order)…
      expect(matchesNoDragRule(el)).toBe(true);
      // …but also matched by the later reset rule, which wins.
      expect(
        resetSelectors.some((sel) => el.matches(sel)),
        `#${id} inside clip container must match a reset selector`,
      ).toBe(true);
    }
  });

  it('the reset rule is declared after the no-drag rule so it wins the cascade', () => {
    const noDragIndex = globalCss.indexOf('.app-no-drag {');
    const resetIndex = globalCss.indexOf('-webkit-app-region: initial');
    expect(noDragIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeGreaterThan(noDragIndex);
  });

  it('WorkspaceTabStrip scroll container carries data-app-region-clip', () => {
    const source = read('lib/components/layout/WorkspaceTabStrip.svelte');
    const container = source.match(/<div[^>]*data-workspace-tab-strip[^>]*>/s)?.[0] ?? '';
    expect(container).toContain('data-app-region-clip');
  });
});

describe('no-drag rule loads in every window, not only the (app) group (#2167)', () => {
  it('ships in app.css, which the root layout imports for all routes', () => {
    // /hud (the standalone HUD window) lives outside (app); scoping the rule
    // to the (app) layout made every HUD header control start a window drag.
    expect(noDragSelectors.length).toBeGreaterThan(0);
    expect(rootLayoutSource).toContain("import '../app.css'");
  });

  it('the (app)-scoped stylesheet no longer carries the no-drag rule', () => {
    expect(extractNoDragSelectors(`<style>${appLayoutCss}</style>`)).toEqual([]);
  });
});
