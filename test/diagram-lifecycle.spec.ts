import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import type { DiagramPrimitive } from '../src/shared/types/notes-primitives';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');

function diagram(id: string): DiagramPrimitive {
  return {
    id,
    type: 'diagram',
    version: 1,
    createdAt: '2026-09-12T00:00:00.000Z',
    createdBy: 'user',
    grammar: 'flowchart',
    model: {
      nodes: [
        { id: `${id}-one`, label: 'Receive request', kind: 'process' },
        { id: `${id}-two`, label: 'Process request', kind: 'process' },
        { id: `${id}-three`, label: 'Return result', kind: 'process' },
      ],
      edges: [
        { id: `${id}-a`, from: `${id}-one`, to: `${id}-two`, label: 'validate' },
        { id: `${id}-b`, from: `${id}-two`, to: `${id}-three`, label: 'complete' },
      ],
    },
    baseView: { layout: { type: 'layered', direction: 'LR' } },
    states: [{ id: 'start', visibleNodes: [`${id}-one`], visibleEdges: [] }, { id: 'finish' }],
    currentStateId: 'start',
  };
}

async function open(page: Page, motion: 'full' | 'reduced') {
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-walkthrough&theme=light&width=960&motion=${motion}`,
  );
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const path = 'src/lib/components/diagrams/DiagramRenderer.svelte';
  const served = await (await page.request.get(`${baseUrl}/${path}`)).text();
  const map = served.match(/sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/);
  expect(map, 'served renderer must expose exact source identity').not.toBeNull();
  const sources = JSON.parse(Buffer.from(map![1], 'base64').toString()).sourcesContent;
  expect(sources).toContain(await readFile(path, 'utf8'));
  await page.evaluate(async (data) => {
    const [{ createClassComponent }, { default: DiagramRenderer }] = await Promise.all([
      import('/@id/svelte/legacy'),
      import('/src/lib/components/diagrams/DiagramRenderer.svelte'),
    ]);
    const host = document.createElement('div');
    host.id = 'lifecycle-host';
    host.style.cssText = 'width:960px;margin:40px';
    document.body.replaceChildren(host);
    const updates: unknown[] = [];
    const instance = createClassComponent({
      component: DiagramRenderer,
      target: host,
      props: { diagram: data, onUpdate: (update: unknown) => updates.push(update) },
    });
    Object.assign(window, { lifecycle: { instance, updates, original: host.firstElementChild } });
  }, diagram('A'));
  const root = page.locator('#lifecycle-host .diagram-renderer');
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  return root;
}

async function replace(page: Page, incoming: DiagramPrimitive) {
  await page.evaluate((data) => {
    const { lifecycle } = window as any;
    lifecycle.payload = data;
    lifecycle.payloadBefore = JSON.stringify(data);
    lifecycle.instance.$set({ diagram: data });
  }, incoming);
}

async function geometry(page: Page) {
  return page.locator('#lifecycle-host .diagram-renderer').evaluate((root) => {
    const rect = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      root: rect(root),
      viewport: rect(root.querySelector('.diagram-scroll-container')!),
      footer: rect(root.querySelector('.diagram-footer')!),
      nodes: [...root.querySelectorAll('[data-node-id]')].map((e) => ({
        id: e.getAttribute('data-node-id'),
        ...rect(e),
      })),
    };
  });
}

test('replacement restores the saved scene and real keyboard entry without persistence', async ({
  page,
}, info) => {
  const root = await open(page, 'reduced');
  const before = await geometry(page);
  const incoming = diagram('B');
  incoming.states![0].id = 'idle';
  incoming.states![1].id = 'done';
  incoming.currentStateId = 'done';
  await replace(page, incoming);
  await expect(root).toHaveAttribute('data-diagram-state', 'done');
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  await expect(root.locator('[data-node-id]')).toHaveCount(3);
  await expect(root.locator('[data-node-id^="A-"]')).toHaveCount(0);
  await expect(root.locator('[aria-current="step"]')).toHaveAttribute(
    'data-diagram-step-index',
    '1',
  );
  expect(
    await page.evaluate(() => {
      const { lifecycle } = window as any;
      return {
        same: lifecycle.original === document.querySelector('.diagram-renderer'),
        unchanged: JSON.stringify(lifecycle.payload) === lifecycle.payloadBefore,
        updates: lifecycle.updates,
      };
    }),
  ).toEqual({ same: true, unchanged: true, updates: [] });
  const replacement = await geometry(page);
  await root.locator('.diagram-fit-button').focus();
  await page.keyboard.press('Tab');
  await expect(root.locator('[data-diagram-step-index="1"]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(root.locator('[data-diagram-step-index="0"]')).toBeFocused();
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  await expect(root.locator('[data-node-id]')).toHaveAttribute('data-node-id', 'B-one');
  expect(await page.evaluate(() => (window as any).lifecycle.updates)).toEqual([
    { currentStateId: 'idle' },
  ]);
  const after = await geometry(page);
  expect(after.viewport).toEqual(replacement.viewport);
  expect(after.footer).toEqual(replacement.footer);
  await writeFile(
    info.outputPath('replacement-geometry.json'),
    JSON.stringify({ before, replacement, after }, null, 2),
  );
  await root.screenshot({ path: info.outputPath('replacement.png') });
});

test('replacement cancels a held camera stage and cannot resume the old scene', async ({
  page,
}, info) => {
  const root = await open(page, 'full');
  const before = await geometry(page);
  await root.evaluate((element) => {
    element.querySelector<HTMLButtonElement>('[data-diagram-step-index="1"]')!.click();
    const animations = element
      .getAnimations({ subtree: true })
      .filter((a) => a.playState === 'running');
    for (const animation of animations) animation.pause();
    Object.assign((window as any).lifecycle, {
      oldAnimations: animations,
      oldFinished: Promise.allSettled(animations.map((animation) => animation.finished)),
    });
  });
  expect(await page.evaluate(() => (window as any).lifecycle.oldAnimations.length)).toBeGreaterThan(
    0,
  );
  await expect(root).toHaveAttribute('data-diagram-motion-phase', 'camera');
  await replace(page, diagram('B'));
  await expect(root).toHaveAttribute('data-diagram-state', 'start');
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  await expect(root.locator('[data-node-id]')).toHaveAttribute('data-node-id', 'B-one');
  await expect(root.locator('[data-edge-id]')).toHaveCount(0);
  const oldStates = await page.evaluate(async () => {
    const { lifecycle } = window as any;
    const states = lifecycle.oldAnimations.map((a: Animation) => a.playState);
    await lifecycle.oldFinished;
    return states;
  });
  expect(oldStates.every((state: string) => state === 'idle' || state === 'finished')).toBe(true);
  await expect(root.locator('[data-node-id]')).toHaveAttribute('data-node-id', 'B-one');
  expect(
    await root.evaluate(
      (e) =>
        e
          .getAnimations({ subtree: true })
          .filter((a) => a.playState === 'running' || a.playState === 'paused').length,
    ),
  ).toBe(0);
  expect(await page.evaluate(() => (window as any).lifecycle.updates)).toEqual([
    { currentStateId: 'finish' },
  ]);
  const after = await geometry(page);
  expect(after.viewport).toEqual(before.viewport);
  expect(after.footer).toEqual(before.footer);
  await writeFile(
    info.outputPath('camera-replacement-geometry.json'),
    JSON.stringify({ before, after }, null, 2),
  );
  await root.screenshot({ path: info.outputPath('camera-replacement.png') });
});
