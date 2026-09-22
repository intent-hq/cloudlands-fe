import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MERMAID_WORKBENCH_CASES } from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');
const source = MERMAID_WORKBENCH_CASES['mermaid-sequence-note'].source;

async function mountNote(
  page: Page,
  info: TestInfo,
  mode: 'native' | 'hold' | 'fail' = 'native',
  width = 960,
) {
  const path = 'src/lib/components/markdown/MermaidRenderer.svelte';
  const response = page.waitForResponse((r) => {
    const url = new URL(r.url());
    return url.pathname === `/${path}` && !url.searchParams.has('type');
  });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // A detached gallery keeps live renderers queued ahead of the note under test.
  await page.goto(`${baseUrl}/sandbox/button?state=default&motion=reduced`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(async () => {
    await import('/src/lib/components/markdown/MermaidRenderer.svelte');
  });
  const body = await (await response).text();
  const encoded = body.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/)?.[1];
  expect(encoded).toBeTruthy();
  const map = JSON.parse(Buffer.from(encoded!, 'base64').toString('utf8'));
  const served =
    map.sourcesContent[map.sources.findIndex((s: string) => s.endsWith('MermaidRenderer.svelte'))];
  expect(served).toBe(await readFile(path, 'utf8'));
  await info.attach('source-identity', {
    body: JSON.stringify({
      path,
      sha256: createHash('sha256').update(served).digest('hex'),
      source,
    }),
    contentType: 'application/json',
  });
  if (mode === 'fail') {
    await page.route('**/sequence-font-failure.woff2', (route) =>
      route.fulfill({ status: 404, body: '' }),
    );
  }
  await page.evaluate(
    async ({ source, mode, width }) => {
      const [{ mount }, { default: NoteWithComments }] = await Promise.all([
        import('/@id/svelte'),
        import('/src/lib/components/workspace/NoteWithComments.svelte'),
      ]);
      const host = document.createElement('div');
      host.id = 'font-note-host';
      host.style.cssText = `width:${width}px;height:800px;margin-left:40px`;
      document.body.replaceChildren(host);
      const calls: object[] = [];
      Object.assign(window, { __sequenceFontCalls: calls });
      const load = document.fonts.load.bind(document.fonts);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.assign(window, { __releaseSequenceFont: release });
      if (mode === 'fail')
        document.fonts.add(
          new FontFace('SequenceFontFailure', 'url(/sequence-font-failure.woff2)'),
        );
      document.fonts.load = (font, content) => {
        const text = [...host.querySelectorAll<SVGTextElement>('.sequence-note-text')].find(
          (text) => text.textContent === content,
        );
        if (!text) return load(font, content);
        const style = getComputedStyle(text);
        const properties = [
          'font',
          'fontFamily',
          'fontSize',
          'fontWeight',
          'fontStyle',
          'fontStretch',
          'fontVariant',
          'fontVariantCaps',
          'fontVariantNumeric',
          'fontVariantLigatures',
          'fontFeatureSettings',
          'fontKerning',
          'fontOpticalSizing',
          'fontVariationSettings',
          'lineHeight',
          'letterSpacing',
        ] as const;
        const call = {
          font,
          content,
          style: Object.fromEntries(properties.map((p) => [p, style[p]])),
          bounds: {
            x: text.getBBox().x,
            y: text.getBBox().y,
            width: text.getBBox().width,
            height: text.getBBox().height,
          },
          variantRules: [...document.styleSheets]
            .flatMap((sheet) => [...sheet.cssRules])
            .filter(
              (rule): rule is CSSStyleRule =>
                rule instanceof CSSStyleRule && !!rule.style.fontVariantLigatures,
            )
            .filter((rule) => text.closest(rule.selectorText))
            .map((rule) => rule.cssText),
          stack: new Error().stack,
          status: 'pending',
          error: '',
        };
        calls.push(call);
        const loading =
          mode === 'fail' ? load('12px "SequenceFontFailure"', content) : load(font, content);
        return loading.then(
          async (faces) => {
            if (mode === 'hold') await held;
            call.status = 'resolved';
            return faces;
          },
          (error: Error) => {
            call.status = 'rejected';
            call.error = `${error.name}: ${error.message}`;
            throw error;
          },
        );
      };
      mount(NoteWithComments, {
        target: host,
        props: {
          workspace: {
            id: 'local-sequence-font-test',
            title: 'Local sequence font test',
            branch: 'test',
            changesets: [],
            timeline: [],
            conversationInfo: [],
            status: 'Active',
            createdAt: '2026-09-12T00:00:00.000Z',
            updatedAt: '2026-09-12T00:00:00.000Z',
          },
          content: `~~~mermaid\n${source}\n~~~`,
          editable: true,
          showSuggestions: false,
          showComments: false,
        },
      });
    },
    { source, mode, width },
  );
}

test('unchanged sequence note loads its computed font in real NoteWithComments', async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await mountNote(page, info);
  const note = page.locator('#font-note-host');
  await expect(note.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true', {
    timeout: 30_000,
  });
  const evidence = await note.evaluate((host) => ({
    calls: (window as typeof window & { __sequenceFontCalls: object[] }).__sequenceFontCalls,
    errors: [...host.querySelectorAll('.error-message')].map((e) => e.textContent),
  }));
  await info.attach('font-load-inputs', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
  await note.screenshot({ path: info.outputPath('sequence-note.png') });
  expect(evidence.calls.length).toBeGreaterThan(0);
  expect(evidence.errors).toEqual([]);
  await expect(note.locator('svg[data-layout-settled=true]')).toHaveCount(1);
  const geometry = await note.locator('svg[data-layout-settled=true]').evaluate((svg) => {
    const text = svg.querySelector<SVGTextElement>('.sequence-note-text')!;
    const rect = text.parentElement!.querySelector<SVGRectElement>('rect.note')!;
    const bounds = text.getBBox();
    const paint = rect.getBBox();
    const style = getComputedStyle(text);
    const viewport = svg.closest('.mermaid-svg-viewport')!.getBoundingClientRect();
    const screen = text.getBoundingClientRect();
    const calls = (
      window as typeof window & {
        __sequenceFontCalls: {
          style: Record<string, string>;
          status: string;
          bounds: { width: number; height: number };
        }[];
      }
    ).__sequenceFontCalls;
    const last = calls.at(-1)!;
    return {
      text: text.textContent,
      font: {
        family: style.fontFamily,
        size: style.fontSize,
        weight: style.fontWeight,
        style: style.fontStyle,
      },
      bounds: { width: bounds.width, height: bounds.height },
      unchangedFont: [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'fontVariantLigatures',
        'fontFeatureSettings',
      ].every((key) => style[key as keyof CSSStyleDeclaration] === last.style[key]),
      before: last.bounds,
      statuses: calls.map((call) => call.status),
      contained:
        screen.left >= viewport.left &&
        screen.right <= viewport.right &&
        screen.top >= viewport.top &&
        screen.bottom <= viewport.bottom,
      gaps: [
        bounds.x - paint.x,
        paint.x + paint.width - bounds.x - bounds.width,
        bounds.y - paint.y,
        paint.y + paint.height - bounds.y - bounds.height,
      ],
    };
  });
  await info.attach('sequence-note-geometry', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  expect(geometry.text).toBe('Shared browser rendering boundary');
  expect(geometry.bounds.width).toBeGreaterThan(0);
  expect(geometry.bounds.height).toBeGreaterThan(0);
  expect(geometry.unchangedFont).toBe(true);
  expect(geometry.bounds).toEqual({ width: geometry.before.width, height: geometry.before.height });
  expect(geometry.statuses.every((status) => status === 'resolved')).toBe(true);
  expect(geometry.contained).toBe(true);
  for (const gap of geometry.gaps) expect(gap).toBeGreaterThanOrEqual(0);
});

test('sequence fit remains pending until the font load finishes, including a narrow refit', async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await mountNote(page, info, 'hold');
  const note = page.locator('#font-note-host');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __sequenceFontCalls: object[] }).__sequenceFontCalls.length,
      ),
    )
    .toBeGreaterThan(0);
  const renderer = note.locator('.mermaid-renderer');
  await expect(renderer).toHaveAttribute('data-render-settled', 'false');
  await expect(note.locator('svg[data-layout-settled=true]')).toHaveCount(0);
  await note.evaluate((host) => {
    host.style.width = '320px';
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(renderer).toHaveAttribute('data-render-settled', 'false');
  await page.evaluate(() =>
    (window as typeof window & { __releaseSequenceFont: () => void }).__releaseSequenceFont(),
  );
  await expect(renderer).toHaveAttribute('data-render-settled', 'true', { timeout: 30_000 });
  await expect(note.locator('.mermaid-error')).toHaveCount(0);
  await expect(note.locator('svg[data-layout-settled=true]')).toHaveCount(1);
  const result = await renderer.evaluate((renderer) => {
    const text = renderer.querySelector('.sequence-note-text')!.getBoundingClientRect();
    const viewport = renderer.querySelector('.mermaid-svg-viewport')!.getBoundingClientRect();
    return {
      active: renderer.getAttribute('data-render-generation'),
      settled: renderer.getAttribute('data-render-settled-generation'),
      text: text.toJSON(),
      viewport: viewport.toJSON(),
    };
  });
  await info.attach('delayed-font-refit', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  expect(result.active).not.toBeNull();
  expect(result.settled).toBe(result.active);
  expect(result.text.width).toBeGreaterThan(0);
  expect(result.text.left).toBeGreaterThanOrEqual(result.viewport.left);
  expect(result.text.right).toBeLessThanOrEqual(result.viewport.right);
});

test('a genuine native font download failure reaches the note error state', async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await mountNote(page, info, 'fail');
  const note = page.locator('#font-note-host');
  await expect(note.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true', {
    timeout: 30_000,
  });
  await expect(note.locator('.mermaid-error')).toHaveCount(1);
  await expect(note.locator('svg[data-layout-settled=true]')).toHaveCount(0);
  const evidence = await page.evaluate(
    () =>
      (window as typeof window & { __sequenceFontCalls: { status: string; error: string }[] })
        .__sequenceFontCalls,
  );
  await info.attach('native-load-failure', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
  expect(evidence.length).toBeGreaterThan(0);
  expect(
    evidence.every((call) => call.status === 'rejected' && call.error.startsWith('NetworkError:')),
  ).toBe(true);
});
