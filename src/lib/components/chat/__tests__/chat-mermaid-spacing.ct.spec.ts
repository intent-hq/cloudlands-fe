import { readFile } from 'node:fs/promises';
import { expect, test } from '../../../../test/ct-test';
import StreamingMessageContent from '../StreamingMessageContent.svelte';
import MessageContent from '../MessageContent.svelte';

const source = 'flowchart LR\n A[Draft] --> B[Review]\n B --> C[Release]';
const content = (code: string) => [
  {
    type: 'text' as const,
    text: `Here is the review flow.\n\n~~~mermaid\n${code}\n~~~\n\nThe release is ready after review.`,
  },
];

type Chat = Awaited<ReturnType<Parameters<Parameters<typeof test.beforeEach>[1]>[0]['mount']>>;

async function geometry(component: Chat) {
  return component.evaluate((root) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const paragraphs = [...root.querySelectorAll('p')].filter((p) => !p.closest('svg'));
    // Measure browser paint, not the renderer's own fitted-bounds metadata or CSS constants.
    const paint = [
      ...root.querySelectorAll('.mermaid-svg .node, .mermaid-svg .flowchart-link'),
    ].map(box);
    const top = Math.min(...paint.map((r) => r.top));
    const bottom = Math.max(...paint.map((r) => r.bottom));
    const toolbar = box(root.querySelector('[role="toolbar"]')!);
    const viewport = box(root.querySelector('.mermaid-svg-viewport')!);
    const buttons = [...root.querySelectorAll('[role="toolbar"] button')].map(box);
    return {
      topGap: top - box(paragraphs[0]).bottom,
      bottomGap: box(paragraphs.at(-1)!).top - bottom,
      top,
      bottom,
      toolbar,
      viewport,
      buttons,
      paint,
    };
  });
}

function expectCompact(g: Awaited<ReturnType<typeof geometry>>) {
  // The established lower prose gap is the independent balance oracle. A second
  // reserved action row must not make the upper gap larger, nor pad the lower gap.
  expect(g.topGap).toBeLessThanOrEqual(g.bottomGap + 8);
  expect(g.topGap).toBeLessThanOrEqual(80);
  expect(g.bottomGap).toBeLessThanOrEqual(73); // 72px baseline, at most 1px font/pixel rounding.
  expect(g.toolbar.bottom).toBeLessThanOrEqual(g.top - 4);
  for (const r of g.paint) {
    expect(r.left).toBeGreaterThanOrEqual(g.viewport.left - 1);
    expect(r.right).toBeLessThanOrEqual(g.viewport.right + 1);
    expect(r.top).toBeGreaterThanOrEqual(g.viewport.top);
    expect(r.bottom).toBeLessThanOrEqual(g.viewport.bottom);
  }
  for (const [i, button] of g.buttons.entries()) {
    expect(button.left).toBeGreaterThanOrEqual(g.toolbar.left);
    expect(button.right).toBeLessThanOrEqual(g.toolbar.right);
    if (i > 0) expect(button.left).toBeGreaterThanOrEqual(g.buttons[i - 1].right);
  }
}

test('chat Mermaid keeps compact stable paint while keyboard actions source, expand and export', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 800 });
  const component = await mount(StreamingMessageContent, {
    props: { content: content(source), isStreaming: true },
  });
  await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
    'data-render-settled',
    'true',
  );
  const initial = await geometry(component);
  expectCompact(initial);
  const toolbar = component.getByRole('toolbar');
  const sourceButton = toolbar.getByRole('button', { name: 'View source' });
  const expand = toolbar.getByRole('button', { name: 'Expand diagram to fullscreen' });
  const menu = toolbar.getByRole('button', { name: 'Diagram actions' });

  await component.hover();
  expect(await geometry(component)).toEqual(initial);
  await sourceButton.focus();
  await expect(toolbar).toHaveCSS('opacity', '1');
  expect(await geometry(component)).toEqual(initial);
  await sourceButton.press('Enter');
  await expect(component.getByRole('region', { name: 'View source' })).toContainText(source);
  await sourceButton.press('Enter');
  await expect(component.getByRole('region', { name: 'View source' })).toHaveCount(0);
  expect(await geometry(component)).toEqual(initial);
  await sourceButton.press('Tab');
  await expect(expand).toBeFocused();
  await expand.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.fullscreen-diagram .node')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(expand).toBeFocused();
  await expand.press('Tab');
  await expect(menu).toBeFocused();

  // Capture this context's clipboard boundary without touching the user's clipboard.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copiedSvg = text;
        },
        write: async (items: ClipboardItem[]) => {
          const png = await items[0].getType('image/png');
          document.documentElement.dataset.copiedPngBytes = String(png.size);
        },
      },
    });
  });
  await menu.press('ArrowDown');
  await page.getByRole('menuitem', { name: 'Copy SVG', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.copiedSvg))
    .toContain('Release');
  const copied = await page.evaluate(() => {
    const svg = new DOMParser().parseFromString(
      document.documentElement.dataset.copiedSvg!,
      'image/svg+xml',
    );
    return {
      nodes: svg.querySelectorAll('.node').length,
      error: !!svg.querySelector('parsererror'),
    };
  });
  expect(copied).toEqual({ nodes: 3, error: false });
  await menu.click();
  await page.getByRole('menuitem', { name: 'Copy image', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Number(document.documentElement.dataset.copiedPngBytes)))
    .toBeGreaterThan(100);
  await menu.click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download SVG', exact: true }).click();
  const download = await downloadEvent;
  const downloaded = await readFile((await download.path())!, 'utf8');
  expect(downloaded).toContain('Draft');
  expect(downloaded).toContain('Review');
  expect(downloaded).toContain('Release');
  expect(await geometry(component)).toEqual(initial);
});

test.describe('narrow touch chat', () => {
  test.use({ hasTouch: true, viewport: { width: 240, height: 800 } });
  test('completed Mermaid exposes reachable controls without clipping or hover', async ({
    mount,
  }) => {
    const component = await mount(MessageContent, {
      props: { content: content(source.replace('LR', 'TD')) },
    });
    await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
      'data-render-settled',
      'true',
    );
    expectCompact(await geometry(component));
    const toolbar = component.getByRole('toolbar');
    await expect(toolbar).toHaveCSS('opacity', '1');
    await toolbar.getByRole('button', { name: 'View source' }).tap();
    await expect(component.getByRole('region', { name: 'View source' })).toBeVisible();
    await toolbar.getByRole('button', { name: 'View source' }).tap();
    await toolbar.getByRole('button', { name: 'Diagram actions' }).tap();
    await expect(component.getByRole('button', { name: 'Diagram actions' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
