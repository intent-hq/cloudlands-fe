import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expectDrawingReachable } from './diagram-scroll-reachability';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running preview server.');

async function openNotes(page: Page, width = 960, motion = 'reduced') {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference' });
  await page.goto(
    `${baseUrl}/sandbox/diagram-controls-host?state=notes&theme=light&width=${width}&motion=${motion}`,
  );
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const host = page.getByTestId('note-host-0');
  await host.evaluate((element, width) => {
    (element as HTMLElement).style.width = `${width}px`;
  }, width);
  await expect(host.locator('.ProseMirror .diagram-renderer')).toHaveCount(2);
  await expect.poll(async () => (await geometry(host)).port.width).toBe(width);
  for (const root of await host.locator('.diagram-renderer').all()) await settled(root);
  return host;
}

async function settled(root: Locator) {
  await expect(root).toHaveAttribute('data-diagram-settled', 'true', { timeout: 30_000 });
}

async function position(host: Locator, diagram: number, top: number) {
  await host.evaluate(
    async (element, { diagram, top }) => {
      const port = element.querySelector<HTMLElement>('#editor-content')!;
      const root = element.querySelectorAll('.diagram-renderer')[diagram];
      port.scrollTop += root.getBoundingClientRect().top - port.getBoundingClientRect().top - top;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    },
    { diagram, top },
  );
}

async function geometry(host: Locator) {
  return host.evaluate((element) => {
    const bounds = (e: Element) => {
      const r = e.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
      };
    };
    const port = element.querySelector<HTMLElement>('#editor-content')!;
    return {
      port: bounds(port),
      scroll: port.scrollTop,
      overflow: port.scrollWidth - port.clientWidth,
      totalControls: element.querySelectorAll('.diagram-controls').length,
      diagrams: [...element.querySelectorAll('.diagram-renderer')].map((root) => {
        const viewport = root.querySelector('.diagram-scroll-container')!;
        const footer = root.querySelector('.diagram-footer');
        const svg = root.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
        const scale = Math.hypot(svg.getScreenCTM()!.a, svg.getScreenCTM()!.b);
        const paint = [
          ...viewport.querySelectorAll<SVGGraphicsElement>(
            '[data-node-id], .group-bg, .group-label, .edge-path, .edge-label-container',
          ),
        ]
          .filter((e) => {
            for (let node: Element | null = e; node && node !== root; node = node.parentElement) {
              const s = getComputedStyle(node);
              if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0)
                return false;
            }
            return true;
          })
          .map((e) => {
            const box = bounds(e);
            const margin = e.matches('.edge-path') ? 3.5 * scale + 0.5 : 0;
            return {
              ...box,
              top: box.top - margin,
              bottom: box.bottom + margin,
              left: box.left - margin,
              right: box.right + margin,
            };
          });
        return {
          root: bounds(root),
          viewport: bounds(viewport),
          drawing: bounds(root.querySelector('.diagram-content')!),
          footer: footer ? bounds(footer) : null,
          controls: root.querySelectorAll('.diagram-controls').length,
          visible: footer ? getComputedStyle(footer).visibility : null,
          nestedInViewport: footer ? viewport.contains(footer) : null,
          paint,
        };
      }),
    };
  });
}

async function expectLocal(result: Awaited<ReturnType<typeof geometry>>, host: Locator) {
  for (const root of await host.locator('.diagram-renderer').all())
    await expectDrawingReachable(root);
  expect(result.overflow).toBeLessThanOrEqual(1);
  expect(result.totalControls).toBe(result.diagrams.length);
  for (const {
    root,
    viewport,
    drawing,
    footer,
    controls,
    visible,
    nestedInViewport,
    paint,
  } of result.diagrams) {
    expect(controls, 'each diagram keeps its own controls').toBe(1);
    expect(footer, 'footer is owned by the renderer, not a note band').not.toBeNull();
    expect(visible).toBe('visible');
    expect(nestedInViewport).toBe(false);
    expect(footer!.height).toBeGreaterThan(20);
    expect(Math.abs(footer!.bottom - root.bottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(footer!.top - viewport.bottom)).toBeLessThanOrEqual(1);
    expect(footer!.left).toBeGreaterThanOrEqual(root.left - 1);
    expect(footer!.right).toBeLessThanOrEqual(root.right + 1);
    expect(paint.length).toBeGreaterThan(0);
    for (const box of paint) {
      expect(box.top).toBeGreaterThanOrEqual(drawing.top - 1);
      expect(box.bottom).toBeLessThanOrEqual(drawing.bottom + 1);
      expect(box.left).toBeGreaterThanOrEqual(drawing.left - 1);
      expect(box.right).toBeLessThanOrEqual(drawing.right + 1);
      expect(Math.min(box.bottom, viewport.bottom)).toBeLessThanOrEqual(footer!.top + 1);
    }
  }
}

async function capture(host: Locator, info: TestInfo, name: string) {
  const result = await geometry(host);
  const path = info.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(result, null, 2));
  await info.attach(name, {
    path,
    contentType: 'application/json',
  });
  await host.screenshot({ path: info.outputPath(`${name}.png`) });
  return result;
}

test('two visible diagrams retain independent controls in two real note panels', async ({
  page,
}, info) => {
  const host = await openNotes(page);
  const other = page.getByTestId('note-host-1');
  // These authored walkthroughs together exceed the ordinary 560px panel.
  // Make both footers genuinely visible rather than assuming fixture heights.
  await page.setViewportSize({ width: 1280, height: 1800 });
  await host.evaluate((element) => {
    (element as HTMLElement).style.height = '1400px';
  });
  await position(host, 0, 0);
  await position(other, 0, 0);
  const first = host.locator('.diagram-renderer').nth(0);
  const second = host.locator('.diagram-renderer').nth(1);
  const before = await capture(host, info, 'two-visible');
  await expectLocal(before, host);
  for (const diagram of before.diagrams) {
    expect(diagram.footer!.top).toBeGreaterThanOrEqual(before.port.top);
    expect(diagram.footer!.bottom).toBeLessThanOrEqual(before.port.bottom);
  }
  await second.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(second).toHaveAttribute('data-diagram-state', 'verify');
  await expect(first).toHaveAttribute('data-diagram-state', 'orient');
  await expect(other.locator('.diagram-renderer').nth(1)).toHaveAttribute(
    'data-diagram-state',
    'draft',
  );
  await first.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(first).toHaveAttribute('data-diagram-state', 'connect');
  await expect(second).toHaveAttribute('data-diagram-state', 'verify');
  await expect(other.locator('.diagram-renderer').nth(0)).toHaveAttribute(
    'data-diagram-state',
    'orient',
  );
  await settled(first);
  await settled(second);
  await expectLocal(await geometry(host), host);
  await expectLocal(await geometry(other), other);
});

test('wheel scrolling over a diagram moves its footer with the note', async ({ page }) => {
  const host = await openNotes(page, 420);
  await position(host, 0, 20);
  const viewport = host.locator('.diagram-scroll-container').first();
  const before = await geometry(host);
  await viewport.hover();
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => (await geometry(host)).scroll).toBeGreaterThan(before.scroll + 50);
  const after = await geometry(host);
  await expectLocal(after, host);
  expect(after.diagrams[0].footer!.top - before.diagrams[0].footer!.top).toBeCloseTo(
    before.scroll - after.scroll,
    0,
  );
});

test('keyboard focus stays on its own footer during note scroll and state changes', async ({
  page,
}) => {
  const host = await openNotes(page);
  await position(host, 0, 0);
  const first = host.locator('.diagram-renderer').first();
  const step = (index: number) => first.locator(`[data-diagram-step-index="${index}"]`);
  await step(0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(step(1)).toBeFocused();
  await expect(first).toHaveAttribute('data-diagram-state', 'connect');
  await page.keyboard.press('End');
  await expect(step(2)).toBeFocused();
  await expect(first).toHaveAttribute('data-diagram-state', 'observe');
  await page.keyboard.press('Home');
  await expect(step(0)).toBeFocused();
  await expect(first).toHaveAttribute('data-diagram-state', 'orient');
  await settled(first);
  await position(host, 0, -30);
  await expect(step(0)).toBeFocused();
  const before = await geometry(host);
  await page.keyboard.press('Tab');
  await expect(first.getByRole('button', { name: 'Next step', exact: true })).toBeFocused();
  expect((await geometry(host)).scroll).toBe(before.scroll);
  await expect(host.locator('.diagram-renderer').nth(1)).toHaveAttribute(
    'data-diagram-state',
    'draft',
  );
});

for (const motion of ['reduced', 'full']) {
  test(`local footer reserves space through state, fit and narrow-wide-narrow resize · ${motion}`, async ({
    page,
  }, info) => {
    const host = await openNotes(page, 420, motion);
    const first = host.locator('.diagram-renderer').first();
    const second = host.locator('.diagram-renderer').nth(1);
    const initial = (await geometry(host)).diagrams[0];
    await position(host, 0, 0);
    for (const [width, index, state] of [
      [420, 1, 'connect'],
      [960, 2, 'observe'],
      [320, 0, 'orient'],
    ] as const) {
      await host.evaluate((element, width) => {
        (element as HTMLElement).style.width = `${width}px`;
      }, width);
      await first.locator(`[data-diagram-step-index="${index}"]`).click();
      await expect(first).toHaveAttribute('data-diagram-state', state);
      await settled(first);
      await settled(second);
      await expectLocal(await capture(host, info, `resize-${width}`), host);
      const fit = first.locator('.diagram-fit-button');
      const pressed = await fit.getAttribute('aria-pressed');
      await fit.click();
      await expect(fit).toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true');
      await settled(first);
      await expectLocal(await geometry(host), host);
    }
    await host.evaluate((element) => {
      (element as HTMLElement).style.width = '420px';
    });
    await settled(first);
    await expect
      .poll(async () => (await geometry(host)).diagrams[0].viewport.height)
      .toBeCloseTo(initial.viewport.height, 0);
    await expectLocal(await geometry(host), host);
  });
}

test('view hiding, same-host note replacement and unmount cannot leave controls behind', async ({
  page,
}) => {
  const host = await openNotes(page);
  const other = page.getByTestId('note-host-1');
  const noteSurface = await host.locator('.workspace-spec-with-comments').elementHandle();
  await position(host, 0, 0);
  await page.getByTestId('toggle-band').click();
  await expect(host.locator('.diagram-controls:visible')).toHaveCount(0);
  await page.getByTestId('toggle-band').click();
  await expect(host.locator('.diagram-controls:visible')).toHaveCount(2);
  await page.getByTestId('switch-note').click();
  await expect(host.locator('.diagram-controls')).toHaveCount(0);
  expect(await host.evaluate((element, surface) => element.contains(surface), noteSurface)).toBe(
    true,
  );
  await expectLocal(await geometry(other), other);
  await page.getByTestId('switch-note').click();
  await settled(host.locator('.diagram-renderer'));
  await expect(host.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true', {
    timeout: 30_000,
  });
  await expect(host.locator('.diagram-controls')).toHaveCount(0);
  await page.getByTestId('switch-note').click();
  await expect(host.locator('.diagram-controls')).toHaveCount(2);
  await position(host, 0, 0);
  await page.getByTestId('toggle-mount').click();
  await expect(host).toHaveCount(0);
  await expect(page.locator('.diagram-controls')).toHaveCount(2);
  await expectLocal(await geometry(other), other);
});

test('standalone walkthrough keeps its local footer and fit controls without a note host', async ({
  page,
}) => {
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-architecture&theme=light&width=420&motion=reduced`,
  );
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 30_000 });
  const root = page.locator('#custom-architecture .diagram-renderer');
  await settled(root);
  await root.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(root).toHaveAttribute('data-diagram-state', 'connect');
  await settled(root);
  const footer = await root.locator('.diagram-footer').boundingBox();
  const viewport = await root.locator('.diagram-scroll-container').boundingBox();
  const bounds = await root.boundingBox();
  expect(footer!.y).toBeCloseTo(viewport!.y + viewport!.height, 0);
  expect(footer!.y + footer!.height).toBeCloseTo(bounds!.y + bounds!.height, 0);
  await expect(root.locator('.diagram-controls')).toHaveCount(1);
});

for (const width of [320, 420, 960]) {
  test(`real note keeps each footer local through entry, scroll and exit · ${width}`, async ({
    page,
  }, info) => {
    const host = await openNotes(page, width);
    await position(host, 0, 300);
    const entry = await capture(host, info, 'entry');
    await expectLocal(entry, host);
    await position(host, 0, 40);
    const middle = await capture(host, info, 'middle');
    await expectLocal(middle, host);
    const delta = middle.scroll - entry.scroll;
    expect(delta).toBeGreaterThan(200);
    for (const [index, diagram] of middle.diagrams.entries()) {
      expect(diagram.footer!.top - entry.diagrams[index].footer!.top).toBeCloseTo(-delta, 0);
    }
    await host.locator('#editor-content').evaluate((port) => {
      port.scrollTop = port.scrollHeight;
    });
    const exit = await capture(host, info, 'exit');
    await expectLocal(exit, host);
    for (const diagram of exit.diagrams) expect(diagram.footer!.bottom).toBeLessThan(exit.port.top);
    await expect(
      host.getByRole('button', { name: 'Next step', exact: true }).last(),
    ).not.toBeInViewport();
  });
}
