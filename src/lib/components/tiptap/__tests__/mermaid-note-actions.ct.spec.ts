import { expect, test } from '../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import MermaidBlockLaneHarness from './MermaidBlockLaneHarness.svelte';

// Exact first diagram from remote intent note fc22cd59-9d8c-466c-96f8-467992ea1e9a.
const SOURCE = `flowchart TB
    subgraph window [One Intent window]
        A[Website tab · This Mac]
        B[Backend tab · Office Linux]
        C[Experiment tab · Home Mac]
    end
    A --> D[Local intentd]
    B --> E[Office intentd]
    C --> F[Home intentd]
    D --> G[Local files and agents]
    E --> H[Office files and agents]
    F --> I[Home files and agents]`;

const measure = (component: Locator) =>
  component.evaluate((root) => {
    const rect = (element: Element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    const surface = rect(root.querySelector('[data-diagram-presentation]')!);
    const svg = root.querySelector<SVGSVGElement>('.mermaid-svg > svg')!;
    const frame = rect(svg);
    const bounds = svg.getBBox();
    const matrix = svg.getScreenCTM()!;
    const paintTop = new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix).y;
    const paintBottom = new DOMPoint(bounds.x, bounds.y + bounds.height).matrixTransform(matrix).y;
    const paragraphs = root.querySelectorAll('.ProseMirror > p');
    const host = root.querySelector<HTMLElement>('[data-testid="note-host"]') ?? root;
    const buttons = [
      ...root.querySelectorAll<HTMLButtonElement>('[data-diagram-presentation-actions] button'),
    ].map(rect);
    return {
      surface,
      frame,
      paint: { top: paintTop, bottom: paintBottom },
      svgGap: { top: frame.top - surface.top, bottom: surface.bottom - frame.bottom },
      paintGap: { top: paintTop - surface.top, bottom: surface.bottom - paintBottom },
      before: rect(paragraphs[0]),
      after: rect(paragraphs[1]),
      host: rect(host),
      overflow: host.scrollWidth - host.clientWidth,
      buttons,
    };
  });

function expectBalancedCanvas(geometry: Awaited<ReturnType<typeof measure>>) {
  expect(geometry.paint.bottom).toBeGreaterThan(geometry.paint.top);
  expect(Math.abs(geometry.svgGap.top - geometry.svgGap.bottom)).toBeLessThanOrEqual(1);
  // Existing lower safety inset is 20px; balancing must not pad out the bottom.
  expect(geometry.svgGap.bottom).toBeGreaterThan(0);
  expect(geometry.svgGap.bottom).toBeLessThanOrEqual(21);
  expect(Math.abs(geometry.paintGap.top - geometry.paintGap.bottom)).toBeLessThanOrEqual(2);
  expect(geometry.paint.top).toBeGreaterThanOrEqual(geometry.frame.top);
  expect(geometry.paint.bottom).toBeLessThanOrEqual(geometry.frame.bottom);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.buttons).toHaveLength(3);
  for (const button of geometry.buttons) {
    expect(button.top).toBeGreaterThanOrEqual(geometry.before.bottom);
    expect(button.bottom).toBeLessThan(geometry.paint.top);
    expect(button.left).toBeGreaterThanOrEqual(geometry.host.left);
    expect(button.right).toBeLessThanOrEqual(geometry.host.right);
    expect(button.height).toBeGreaterThanOrEqual(28);
    expect(Math.abs(button.top - geometry.buttons[0].top)).toBeLessThanOrEqual(1);
    expect(Math.abs(button.height - geometry.buttons[0].height)).toBeLessThanOrEqual(1);
  }
}

for (const { name, hostWidth, editable } of [
  { name: 'wide note', hostWidth: 1336, editable: true },
  { name: 'narrow note', hostWidth: 420, editable: true },
  { name: 'narrow read-only note', hostWidth: 420, editable: false },
]) {
  test(`keeps ${name} spacing and actions stable`, async ({ mount, page }) => {
    await page.setViewportSize({ width: hostWidth + 64, height: 2000 });
    const component = await mount(MermaidBlockLaneHarness, {
      props: { code: SOURCE, hostWidth, editable },
    });
    await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
      'data-render-settled',
      'true',
      { timeout: 30_000 },
    );
    const surface = component.locator('[data-diagram-presentation]');
    await expect(surface).toHaveAttribute('data-diagram-presentation-settled', 'true');
    await surface.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const initial = await measure(component);
    expectBalancedCanvas(initial);
    await surface.hover();
    expect(await measure(component)).toEqual(initial);

    const primary = component.getByRole('button', { name: editable ? 'Edit code' : 'View source' });
    await primary.focus();
    await expect(primary).toBeFocused();
    await expect(primary).toHaveCSS('outline-style', 'solid');
    await expect(primary).toHaveCSS('outline-width', '2px');
    expect(await measure(component)).toEqual(initial);

    await primary.press('Enter');
    if (editable) {
      await expect(component.getByRole('button', { name: 'View source' })).toHaveCount(0);
      const codeEditor = component.locator('.code-editor-wrapper').getByRole('textbox');
      await expect(codeEditor).toHaveCount(1);
      await expect(codeEditor).toHaveValue(SOURCE);
      await codeEditor.press('Escape');
      await expect(codeEditor).toHaveCount(0);
    } else {
      await expect(component.getByRole('button', { name: 'Edit code' })).toHaveCount(0);
      await expect(primary).toHaveAttribute('aria-pressed', 'true');
      await expect(component.getByRole('region', { name: 'View source' })).toHaveText(SOURCE);
      await primary.press('Enter');
      await expect(primary).toHaveAttribute('aria-pressed', 'false');
      await expect(component.getByRole('region', { name: 'View source' })).toHaveCount(0);
    }
    // Source toggles queue presentation layout even when its dimensions are unchanged.
    await expect(surface).toHaveAttribute('data-diagram-presentation-settled', 'true');
    await expect.poll(() => measure(component)).toEqual(initial);

    const fullscreen = component.getByRole('button', { name: 'Fullscreen', exact: true });
    await fullscreen.focus();
    await fullscreen.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Fullscreen diagram view' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('One Intent window');
    await expect(dialog).toContainText('Home files and agents');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(fullscreen).toBeFocused();

    const more = component.getByRole('button', { name: 'Diagram actions', exact: true });
    await more.focus();
    await more.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(more).toBeFocused();
    expect(await measure(component)).toEqual(initial);
  });
}

for (const activation of ['keyboard', 'mouse'] as const) {
  test(`retains ${activation} fullscreen activation while note presentation settles`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 484, height: 2000 });
    const component = await mount(MermaidBlockLaneHarness, {
      props: { code: SOURCE, hostWidth: 420, editable: false },
    });
    const surface = component.locator('[data-diagram-presentation]');
    await expect(surface).toHaveAttribute('data-diagram-presentation-settled', 'true');
    const initial = await measure(component);
    await surface.hover();
    const source = component.getByRole('button', { name: 'View source' });
    await source.click();
    await expect(source).toHaveAttribute('aria-pressed', 'true');
    await expect(surface).toHaveAttribute('data-diagram-presentation-settled', 'true');
    const fullscreen = component.getByRole('button', { name: 'Fullscreen', exact: true });
    await fullscreen.focus();
    const button = (await fullscreen.boundingBox())!;

    // Hold the actual shared layout queue, not its readiness marker. Closing source
    // still runs the real presentation MutationObserver and marks its geometry pending.
    await page.evaluate(() => {
      const request = window.requestAnimationFrame;
      const cancel = window.cancelAnimationFrame;
      const callbacks = new Map<number, FrameRequestCallback>();
      let id = -1;
      window.requestAnimationFrame = (callback) => {
        callbacks.set(id, callback);
        return id--;
      };
      window.cancelAnimationFrame = (frame) => {
        if (!callbacks.delete(frame)) cancel(frame);
      };
      (window as unknown as { resumePresentationFrames: () => void }).resumePresentationFrames =
        () => {
          window.requestAnimationFrame = request;
          window.cancelAnimationFrame = cancel;
          for (const callback of callbacks.values()) request(callback);
          callbacks.clear();
        };
      document.querySelector<HTMLButtonElement>('button[aria-label="View source"]')!.click();
    });
    try {
      await expect(source).toHaveAttribute('aria-pressed', 'false');
      await expect(surface).toHaveAttribute('data-diagram-presentation-settled', 'false');
      if (activation === 'keyboard') await page.keyboard.press('Enter');
      else await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
      await expect(page.getByRole('dialog', { name: 'Fullscreen diagram view' })).toHaveCount(0);
    } finally {
      await page.evaluate(() =>
        (window as unknown as { resumePresentationFrames: () => void }).resumePresentationFrames(),
      );
    }
    const dialog = page.getByRole('dialog', { name: 'Fullscreen diagram view' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('One Intent window');
    await expect(dialog).toContainText('Home files and agents');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(fullscreen).toBeFocused();
    expect(await measure(component)).toEqual(initial);
  });
}
