import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import type { DiagramPrimitive } from '../src/shared/types/notes-primitives';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');

const labels = {
  unbroken: 'w'.repeat(200),
  url: `https://example.test/${'x'.repeat(175)}.html`,
  unicode: 'e\u0301👨‍👩‍👧‍👦🇯🇵👍🏽'.repeat(12),
  cjk: '可視化した構成を安全に確認する'.repeat(8),
  filename: `${'implementation'.repeat(15)}.test.ts`,
};

function diagram(label: string, steps = 1): DiagramPrimitive {
  return {
    id: 'narrow-accessibility',
    type: 'diagram',
    version: 1,
    createdAt: '2026-09-12T00:00:00.000Z',
    createdBy: 'user',
    grammar: 'flowchart',
    label: 'Accessibility example',
    model: { nodes: [{ id: 'text', label, kind: 'process' }], edges: [] },
    baseView: { layout: { type: 'layered', direction: 'TB' } },
    states: Array.from({ length: steps }, (_, i) => ({
      id: `step-${i}`,
      ...(steps > 1
        ? {
            narrative: {
              title: `Step ${i + 1}: ${labels.unicode}`,
              text: `Read the full address ${labels.url} and all instructions. `.repeat(3),
            },
          }
        : {}),
    })),
    currentStateId: 'step-0',
  };
}

async function mountNote(page: Page, width: number, data: DiagramPrimitive, count = 1) {
  await page.setViewportSize({ width: 1300, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/sandbox/diagram-workbench?state=custom-walkthrough&motion=reduced`);
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 15_000 });
  for (const path of [
    'src/lib/components/diagrams/DiagramRenderer.svelte',
    'src/lib/components/diagrams/DiagramNodeHTML.svelte',
    'src/lib/components/diagrams/DiagramControls.svelte',
    'src/lib/components/diagrams/diagram-label-wrap.ts',
    'src/lib/components/diagrams/layout-engine.ts',
    'src/lib/components/notes/primitives/DiagramBlock.svelte',
  ]) {
    const served = await (await page.request.get(`${baseUrl}/${path}`)).text();
    const map = served.match(/sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/);
    expect(map, `${path} source identity`).not.toBeNull();
    expect(JSON.parse(Buffer.from(map![1], 'base64').toString()).sourcesContent).toContain(
      await readFile(path, 'utf8'),
    );
  }
  const block = `\`\`\`diagram\n${JSON.stringify(data)}\n\`\`\``;
  await page.evaluate(
    async ({ width, block, count }) => {
      const [{ createClassComponent }, { default: NoteWithComments }] = await Promise.all([
        import('/@id/svelte/legacy'),
        import('/src/lib/components/workspace/NoteWithComments.svelte'),
      ]);
      const host = document.createElement('div');
      host.id = 'narrow-note-host';
      host.style.cssText = `width:${width}px;height:900px;margin-left:80px`;
      document.body.replaceChildren(host);
      const props = {
        workspace: {
          id: 'narrow-accessibility-test',
          title: 'Local test',
          branch: 'test',
          changesets: [],
          timeline: [],
          conversationInfo: [],
          status: 'Active',
          createdAt: '2026-09-12T00:00:00.000Z',
          updatedAt: '2026-09-12T00:00:00.000Z',
        },
        content: `## Diagram accessibility\n\nAdjacent note text.\n\n${Array(count).fill(block).join('\n\nBetween diagrams.\n\n')}\n\nFollowing note text.`,
        editable: true,
        showSuggestions: false,
        showComments: true,
      };
      const remount = () =>
        createClassComponent({ component: NoteWithComments, target: host, props });
      Object.assign(window, { narrowTest: { instance: remount(), remount } });
    },
    { width, block, count },
  );
  await page.evaluate(() => document.fonts.ready);
  const root = page.locator('#narrow-note-host .diagram-renderer');
  await expect(root).toHaveCount(count);
  for (const element of await root.all()) {
    await expect(element).toHaveAttribute('data-diagram-settled', 'true');
  }
  return root.first();
}

async function paint(root: Locator, selector: string) {
  return root.evaluate((root, selector) => {
    const rect = (r: DOMRect) => ({
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    });
    const viewport = root.querySelector<HTMLElement>('.diagram-scroll-container')!;
    const node = root.querySelector('[data-node-id]')!;
    const text = root.querySelector(selector)!;
    const ranges = [];
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      for (const { index, segment } of new Intl.Segmenter(undefined, {
        granularity: 'grapheme',
      }).segment(n.textContent ?? '')) {
        if (!segment.trim()) continue;
        const range = document.createRange();
        range.setStart(n, index);
        range.setEnd(n, index + segment.length);
        ranges.push({ text: segment, ...rect(range.getBoundingClientRect()) });
      }
    }
    const transform = (root.querySelector('.diagram-svg-layer') as SVGSVGElement).getScreenCTM()!;
    return {
      root: rect(root.getBoundingClientRect()),
      viewport: rect(viewport.getBoundingClientRect()),
      node: rect(node.getBoundingClientRect()),
      text: text.textContent,
      ranges,
      fontSize: parseFloat(getComputedStyle(text).fontSize) * Math.hypot(transform.a, transform.b),
      overflowX: getComputedStyle(viewport).overflowX,
      scrollLeft: viewport.scrollLeft,
      scrollWidth: viewport.scrollWidth,
      clientWidth: viewport.clientWidth,
    };
  }, selector);
}

async function capture(root: Locator, info: TestInfo, name: string, data: unknown) {
  await writeFile(info.outputPath(`${name}.json`), JSON.stringify(data, null, 2));
  await root.screenshot({ path: info.outputPath(`${name}.png`) });
}

for (const width of [320, 960]) {
  for (const [kind, label] of Object.entries(labels)) {
    test(`all ${kind} grapheme paint is reachable at ${width}px`, async ({ page }, info) => {
      const root = await mountNote(page, width, diagram(label));
      const fit = root.locator('.diagram-fit-button');
      if ((await fit.getAttribute('aria-pressed')) !== 'true') {
        await fit.focus();
        await page.keyboard.press('Enter');
      }
      await expect(root).toHaveAttribute('data-diagram-settled', 'true');
      const start = await paint(root, '.node-label');
      const viewport = root.locator('.diagram-scroll-container');
      if (['auto', 'scroll'].includes(start.overflowX)) {
        await viewport.evaluate((e) => {
          e.scrollLeft = e.scrollWidth;
        });
      }
      const end = await paint(root, '.node-label');
      await capture(root, info, 'paint', { start, end });
      expect(start.text?.replace(/\s/g, '')).toBe(label.replace(/\s/g, ''));
      expect(start.ranges.map((r) => r.text).join('')).toBe(label);
      expect(start.fontSize).toBeGreaterThanOrEqual(12);
      const unreachable = start.ranges.filter(
        (r, i) =>
          ![r, end.ranges[i]].some((p, j) => {
            const port = [start, end][j].viewport;
            return p.left >= port.left - 1 && p.right <= port.right + 1;
          }),
      );
      expect(unreachable, 'Fit or a user-scrollable viewport must expose every grapheme').toEqual(
        [],
      );
      for (const r of start.ranges) {
        expect(r.top).toBeGreaterThanOrEqual(start.node.top - 1);
        expect(r.bottom).toBeLessThanOrEqual(start.node.bottom + 1);
      }
    });
  }

  test(`long narrative and twenty-step keyboard navigation remain local at ${width}px`, async ({
    page,
  }, info) => {
    const root = await mountNote(page, width, diagram('Readable node', 20));
    const read = () =>
      root.evaluate((root) => {
        const box = (e: Element) => {
          const r = e.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        };
        const footer = root.querySelector('.diagram-footer')!;
        const narrative = root.querySelector('.narrative')!;
        const ranges = [...narrative.querySelectorAll('.narrative-title, .narrative-text')].flatMap(
          (e) => {
            const range = document.createRange();
            range.selectNodeContents(e);
            return [...range.getClientRects()].map((box) => ({
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
            }));
          },
        );
        return {
          root: box(root),
          footer: box(footer),
          narrative: box(narrative),
          ranges,
          controls: [...footer.querySelectorAll('button')].map(box),
          noteOverflow:
            root.closest('#editor-content')!.scrollWidth -
            root.closest('#editor-content')!.clientWidth,
        };
      });
    const initial = await read();
    await capture(root, info, 'controls-initial', initial);
    expect.soft(initial.noteOverflow).toBeLessThanOrEqual(1);
    for (const r of [...initial.ranges, ...initial.controls]) {
      expect.soft(r.left).toBeGreaterThanOrEqual(initial.footer.left - 1);
      expect.soft(r.right).toBeLessThanOrEqual(initial.footer.right + 1);
      expect.soft(r.bottom).toBeLessThanOrEqual(initial.footer.bottom + 1);
    }
    await root.locator('[data-diagram-step-index="0"]').focus();
    for (const [key, index] of [
      ['End', 19],
      ['ArrowLeft', 18],
      ['Home', 0],
      ['ArrowRight', 1],
    ] as const) {
      await page.keyboard.press(key);
      const active = root.locator(`[data-diagram-step-index="${index}"]`);
      await expect(active).toBeFocused();
      await expect(active).toHaveAttribute('aria-current', 'step');
      await expect(root).toHaveAttribute('data-diagram-settled', 'true');
      const r = await active.boundingBox();
      const { footer } = await read();
      expect.soft(r!.x).toBeGreaterThanOrEqual(footer.left);
      expect.soft(r!.x + r!.width).toBeLessThanOrEqual(footer.right);
    }
    await root.getByRole('button', { name: 'Next step', exact: true }).click({ timeout: 3000 });
    await expect(root).toHaveAttribute('data-diagram-state', 'step-2');
    await root.getByRole('button', { name: 'Previous step', exact: true }).click();
    await expect(root).toHaveAttribute('data-diagram-state', 'step-1');
    const before = await read();
    const scroll = await root.evaluate((root) => {
      const port = root.closest('#editor-content')!;
      const before = port.scrollTop;
      port.scrollTop += 100;
      return port.scrollTop - before;
    });
    const after = await read();
    expect(after.footer.top - before.footer.top).toBeCloseTo(-scroll, 0);
    expect(after.footer.bottom).toBeCloseTo(after.root.bottom, 0);
    await capture(root, info, 'controls-after', after);
  });
}

test('two identical diagrams expose independent truthful disclosure relationships through remount', async ({
  page,
}, info) => {
  await mountNote(page, 960, diagram('Disclosure content'), 2);
  const blocks = page.locator('.node-diagram_block');
  const buttons = blocks.locator('button', { hasText: 'Accessibility example' });
  await expect(buttons).toHaveCount(2);
  await capture(
    blocks.first(),
    info,
    'disclosure-before',
    await buttons.evaluateAll((es) =>
      es.map((e) => ({
        expanded: e.getAttribute('aria-expanded'),
        controls: e.getAttribute('aria-controls'),
      })),
    ),
  );
  const ids = await buttons.evaluateAll((es) => es.map((e) => e.getAttribute('aria-controls')));
  expect(ids.every(Boolean)).toBe(true);
  expect(new Set(ids).size).toBe(2);
  for (let i = 0; i < 2; i++) {
    const button = buttons.nth(i);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const region = page.locator(`[id="${ids[i]}"]`);
    await expect(region.locator('.diagram-renderer')).toBeVisible();
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(region.locator('.diagram-renderer')).toHaveCount(0);
    await button.click();
    await expect(button).toHaveAttribute('aria-controls', ids[i]!);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(region.locator('.diagram-renderer')).toBeVisible();
  }
  await page.evaluate(() => {
    const state = (window as any).narrowTest;
    state.instance.$destroy();
    state.instance = state.remount();
  });
  await expect(buttons).toHaveCount(2);
  const nextIds = await buttons.evaluateAll((es) => es.map((e) => e.getAttribute('aria-controls')));
  expect(nextIds.every(Boolean)).toBe(true);
  expect(new Set(nextIds).size).toBe(2);
  for (const button of await buttons.all())
    await expect(button).toHaveAttribute('aria-expanded', 'true');
});

test('wrapped labels and secondary text remain reachable after hidden resize and recovery', async ({
  page,
}, info) => {
  const label = `Short heading\n${labels.url}\n${labels.cjk}`;
  const data = diagram(label);
  const kind = 'metadata'.repeat(24);
  data.model.nodes[0].kind = kind;
  const root = await mountNote(page, 320, data);
  for (const [phase, width] of [320, 960, 320].entries()) {
    await page.locator('#narrow-note-host').evaluate(async (host, width) => {
      host.style.display = 'none';
      await new Promise(requestAnimationFrame);
      host.style.width = `${width}px`;
      host.style.display = '';
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    }, width);
    // The lane follows the host; the presentation now follows readable content
    // with a prose minimum rather than unconditionally filling that lane.
    await expect
      .poll(() => root.evaluate((e) => e.closest<HTMLElement>('.node-diagram_block')!.clientWidth))
      .toBe(width - 8);
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    const sizes = await root.evaluate((e) => ({
      presentation: e.clientWidth,
      prose: e.closest<HTMLElement>('.ProseMirror')!.clientWidth,
      lane: e.closest<HTMLElement>('.node-diagram_block')!.clientWidth,
    }));
    expect(sizes.presentation).toBeGreaterThanOrEqual(sizes.prose);
    expect(sizes.presentation).toBeLessThanOrEqual(sizes.lane);
    for (const [selector, text, floor] of [
      ['.node-label', label, 12],
      ['.node-kind-label', kind, 10],
    ] as const) {
      const result = await paint(root, selector);
      await writeFile(
        info.outputPath(`resize-${phase}-${width}-${selector.slice(1)}.json`),
        JSON.stringify(result, null, 2),
      );
      expect(result.ranges.map((r) => r.text).join('')).toBe(text.replace(/\s/g, ''));
      expect(result.fontSize).toBeGreaterThanOrEqual(floor);
      for (const r of result.ranges) {
        expect(r.left).toBeGreaterThanOrEqual(result.viewport.left - 1);
        expect(r.right).toBeLessThanOrEqual(result.viewport.right + 1);
        expect(r.left).toBeGreaterThanOrEqual(result.node.left - 1);
        expect(r.right).toBeLessThanOrEqual(result.node.right + 1);
        expect(r.top).toBeGreaterThanOrEqual(result.node.top - 1);
        expect(r.bottom).toBeLessThanOrEqual(result.node.bottom + 1);
      }
    }
  }
  const noteScroll = await root.evaluate((root) => {
    const port = root.closest('#editor-content')!;
    const before = port.scrollTop;
    port.scrollTop = port.scrollHeight;
    const r = port.getBoundingClientRect();
    return { delta: port.scrollTop - before, top: r.top, bottom: r.bottom };
  });
  const scrolled = await paint(root, '.node-kind-label');
  expect(noteScroll.delta).toBeGreaterThan(0);
  const last = scrolled.ranges.at(-1)!;
  expect(last.top).toBeGreaterThanOrEqual(noteScroll.top);
  expect(last.bottom).toBeLessThanOrEqual(noteScroll.bottom);
  await writeFile(
    info.outputPath('note-scroll.json'),
    JSON.stringify({ noteScroll, scrolled }, null, 2),
  );
  await root
    .locator('.diagram-footer')
    .screenshot({ path: info.outputPath('resize-footer-recovered.png') });
});
