import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import DockEdgeMotionHarness from './__tests__/DockEdgeMotionHarness.svelte';
import { dockRailPreview, adaptiveDockFixture } from './dock-rail.preview-fixtures';
import {
  dockLocalRect,
  dockWindowEnvelope,
  resolveDockSurface,
  type DockDisplayGeometry,
  type DockPlacementSnapshot,
} from '$shared/dock-placement';

// The open/close video is retained in the Playwright report for review.
test.use({ video: { mode: 'on', size: { width: 1000, height: 700 } } });

async function shot(page: Page, name: string): Promise<void> {
  const info = test.info();
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

/** Composer card insets from the conversation surface: the lane contract shared by placements. */
async function laneInsets(component: Locator) {
  return component.getByTestId('dock-conversation-surface').evaluate((surface) => {
    const card = surface
      .querySelector('[data-testid="message-input"], [data-slot="message-composer"]')!
      .getBoundingClientRect();
    const box = surface.getBoundingClientRect();
    return { left: card.left - box.left, right: box.right - card.right };
  });
}

async function mountSide(mount: (...args: any[]) => Promise<Locator>, page: Page) {
  await page.setViewportSize({ width: 1000, height: 700 });
  // A simulated display, so the preview answers side-panel requests like native does.
  const display: DockDisplayGeometry = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1000, height: 700 },
    workArea: { x: 0, y: 24, width: 1000, height: 676 },
    cutout: null,
  };
  const target = { kind: 'edge' as const, displayId: 1, side: 'right' as const, along: 0.5 };
  const core = resolveDockSurface(target, display, { width: 40, height: 260 });
  const windowBounds = dockWindowEnvelope(core, display, null, 'right', true, 24);
  const placement: DockPlacementSnapshot = {
    ...adaptiveDockFixture('edge', 'right'),
    placement: target,
    windowBounds,
    surface: dockLocalRect(core, windowBounds),
    workArea: dockLocalRect(display.workArea, windowBounds),
  };
  return mount(DockRailPreview, {
    props: {
      ...dockRailPreview.states['side-right'].props,
      placement,
      floatingDisplay: display,
      conversationFixture: true,
      resizeAcknowledgement: 'accept',
      viewportWidth: 1000,
      viewportHeight: 700,
    },
  });
}

test('side conversation is one box beside the unchanged rail, unclipped, with notch lane insets', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const side = await mountSide(mount, page);
  await expect(side.getByTestId('dock-edge-shell')).toHaveCount(0);
  const rail = side.getByTestId('dock-surface');
  const railBefore = await rail.boundingBox();
  await side.locator('[data-dock-entry="dock:assistant"]').click();
  const shell = side.getByTestId('dock-edge-shell');
  await expect(shell).toHaveAttribute('data-reveal', '1');
  const panel = side.getByTestId('dock-conversation-surface');
  await expect(panel).toBeVisible();
  // The rail keeps its size, position and avatars while the conversation is open.
  expect(await rail.boundingBox()).toEqual(railBefore);
  await expect(rail).toHaveCSS('opacity', '1');
  await expect(side.locator('[data-dock-entry="dock:assistant"]')).toBeVisible();
  // The open conversation's entry reads as selected.
  await expect(side.locator('[data-dock-entry][aria-current="true"]')).toHaveCount(1);
  // One box: the open shell is the panel, and it is the only bordered surface around it.
  await expect(shell).toHaveCount(1);
  const [shellBox, panelBox] = await Promise.all([shell.boundingBox(), panel.boundingBox()]);
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(shellBox![key] - panelBox![key])).toBeLessThanOrEqual(1);
  const bordered = await panel.evaluate((element) => {
    const chain: Element[] = [];
    // Panel up to the dock root, plus the shell: the conversation's possible chrome layers.
    for (
      let node: Element | null = element;
      node && node.getAttribute('data-testid') !== 'dock-shell';
      node = node.parentElement
    )
      chain.push(node);
    const shellElement = document.querySelector('[data-testid="dock-edge-shell"]');
    if (shellElement) chain.push(shellElement);
    return chain.filter((node) => parseFloat(getComputedStyle(node).borderTopWidth) > 0).length;
  });
  expect(bordered).toBe(1);
  const chrome = await panel.evaluate((element) => {
    const style = getComputedStyle(element);
    return { border: style.borderLeftWidth, shadow: style.boxShadow };
  });
  expect(chrome).toEqual({ border: '0px', shadow: 'none' });
  // Nothing in the panel is clipped: the composer and Send are inside it and hit-testable.
  // The dock composer or the preview's shared composer, whichever the host renders.
  const card = panel
    .locator('[data-testid="message-input"], [data-slot="message-composer"]')
    .first();
  const send = panel.getByRole('button', { name: /^Send/ }).first();
  const [cardBox, sendBox] = await Promise.all([card.boundingBox(), send.boundingBox()]);
  for (const inner of [cardBox!, sendBox!]) {
    expect(inner.x).toBeGreaterThanOrEqual(panelBox!.x);
    expect(inner.y + inner.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height);
    expect(inner.x + inner.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
  }
  // Typing works: clicking the composer focuses the editor, and keys insert text.
  const editor = panel.getByRole('textbox', { name: 'Message', exact: true });
  await card.click({ position: { x: 40, y: 16 } });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Typed in the side box');
  // A textarea keeps typed text in its value; a rich editor in its text.
  await expect
    .poll(() =>
      editor.evaluate((el) =>
        el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? ''),
      ),
    )
    .toContain('Typed in the side box');
  // With text, Send is live and nothing covers or clips it.
  expect(
    await send.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !!hit && button.contains(hit);
    }),
  ).toBe(true);
  // Native input reaches the whole box: a published pointer region covers the shell.
  const host = await side.locator('.dock-preview-host').boundingBox();
  await expect
    .poll(async () => {
      const regions: { x: number; y: number; width: number; height: number }[] =
        JSON.parse((await side.getAttribute('data-preview-pointer')) ?? '{}').regions ?? [];
      return regions.some(
        (r) =>
          r.x <= shellBox!.x - host!.x + 1 &&
          r.y <= shellBox!.y - host!.y + 1 &&
          r.x + r.width >= shellBox!.x - host!.x + shellBox!.width - 1 &&
          r.y + r.height >= shellBox!.y - host!.y + shellBox!.height - 1,
      );
    })
    .toBe(true);
  const sideInsets = await laneInsets(side);
  await side.unmount();

  const notch = await mount(DockRailPreview, {
    props: { ...dockRailPreview.states.notch.props, conversationFixture: true },
  });
  await notch.getByTestId('dock-drag-handle').hover();
  await notch.locator('[data-dock-row]').first().click();
  await expect(notch.getByTestId('dock-conversation-surface')).toBeVisible();
  const notchInsets = await laneInsets(notch);
  expect(Math.abs(sideInsets.left - notchInsets.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(sideInsets.right - notchInsets.right)).toBeLessThanOrEqual(1);
});

test.describe('side shell motion', () => {
  test('side shell slides from edge and releases input regions on close', async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
    await page.clock.install();
    const side = await mountSide(mount, page);
    await page.clock.runFor(100);
    await shot(page, 'dock-edge-closed');
    await side.locator('[data-dock-entry="dock:assistant"]').click();
    const shell = side.getByTestId('dock-edge-shell');
    // Step frames deterministically until the shell is part-way open.
    const reveal = async () =>
      Number((await shell.getAttribute('data-reveal').catch(() => null)) ?? 0);
    for (let i = 0; i < 120 && (await reveal()) < 0.4; i += 1) await page.clock.runFor(8);
    const mid = await reveal();
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(1);
    // Streaming changes trigger the popup owner's mutation observer during the morph.
    await side.getByTestId('dock-conversation-surface').evaluate((surface) => {
      const update = document.createElement('span');
      update.textContent = 'Synthetic streaming transcript update';
      surface.append(update);
    });
    await page.clock.runFor(32);
    await expect(side.getByTestId('dock-preview')).toHaveCount(0);
    const regions = await side.evaluate((fixture) => {
      const rect = (selector: string) => {
        const box = fixture.querySelector(selector)!.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      return {
        reveal: Number(
          fixture.querySelector('[data-testid="dock-edge-shell"]')!.getAttribute('data-reveal'),
        ),
        host: rect('.dock-preview-host'),
        shell: rect('[data-testid="dock-edge-shell"]'),
        rail: rect('[data-testid="dock-surface"]'),
        scrollport: rect('.side-rail'),
        entryCount: fixture.querySelectorAll('[data-dock-entry]').length,
        regions: JSON.parse(fixture.getAttribute('data-preview-pointer') ?? '{}').regions as {
          x: number;
          y: number;
          width: number;
          height: number;
        }[],
      };
    });
    await testInfo.attach('side-shell-streaming-regions.json', {
      body: JSON.stringify(regions, null, 2),
      contentType: 'application/json',
    });
    await shot(page, 'dock-edge-mid');
    await testInfo.attach('side-shell-streaming-frame.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    expect(regions.reveal).toBeGreaterThan(0.2);
    expect(regions.reveal).toBeLessThan(1);
    // This fixture has no preview or detached popups. Publication order is the rail,
    // visible side entries, animated shell, then the measured conversation surface.
    const shellIndex = 1 + regions.entryCount;
    expect(regions.regions.length).toBeGreaterThan(shellIndex + 1);
    const local = (box: typeof regions.shell) => ({
      ...box,
      x: box.x - regions.host.x,
      y: box.y - regions.host.y,
    });
    const contained = (region: typeof regions.shell, box: typeof regions.shell) =>
      expect(
        region.x >= box.x - 1 &&
          region.y >= box.y - 1 &&
          region.x + region.width <= box.x + box.width + 1 &&
          region.y + region.height <= box.y + box.height + 1,
      ).toBe(true);
    contained(regions.regions[0], local(regions.rail));
    // Magnified entries can extend into the scroll gutter beyond the rail's chrome.
    for (const region of regions.regions.slice(1, shellIndex))
      contained(region, regions.scrollport);
    contained(regions.regions[shellIndex], local(regions.shell));
    for (const region of regions.regions.slice(shellIndex + 1)) contained(region, regions.shell);
    // Let the rest play in real time for the recording.
    for (let i = 0; i < 40 && (await reveal()) < 1; i += 1) {
      await page.clock.runFor(16);
      await page.waitForTimeout(16);
    }
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await shot(page, 'dock-edge-open');
    await page.clock.runFor(300);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    for (let i = 0; i < 60 && (await shell.count()) > 0; i += 1) {
      await page.clock.runFor(16);
      await page.waitForTimeout(16);
    }
    await expect(shell).toHaveCount(0);
    await expect(side.locator('[data-dock-entry][aria-current="true"]')).toHaveCount(0);
    await page.clock.runFor(300);
    await page.waitForTimeout(300);
  });

  test('edge slide preserves velocity on reversal with equivalent 60 and 120 Hz cadence', async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
    const now = new Date('2026-11-06T12:00:00Z');
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now);
    const results: { hz: number; opening: number; samples: number[] }[] = [];
    for (const hz of [60, 120]) {
      await page.evaluate((hz) => {
        window.requestAnimationFrame = (callback) =>
          window.setTimeout(() => callback(performance.now()), 1000 / hz);
        window.cancelAnimationFrame = (id) => window.clearTimeout(id);
      }, hz);
      const component = await mount(DockEdgeMotionHarness);
      const shell = component.getByTestId('dock-edge-shell');
      const frame = () =>
        shell.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            reveal: Number(node.getAttribute('data-reveal')),
          };
        });
      await component.update({ props: { open: true } });
      await page.clock.runFor(104);
      const cadenceProgress = (await frame()).reveal;
      await component.update({ props: { open: false } });
      await page.clock.runFor(500);
      await expect(shell).toHaveCount(0);
      await component.update({ props: { open: true } });
      await page.clock.runFor(32);
      const opening = await frame();
      expect(opening.reveal).toBeGreaterThan(0);
      expect(opening.reveal).toBeLessThan(0.7);
      await component.update({ props: { open: false } });
      expect(await frame()).toEqual(opening);
      await page.clock.runFor(Math.ceil(1000 / hz));
      const turningClosed = await frame();
      expect(turningClosed.reveal).toBeGreaterThan(opening.reveal);
      await page.clock.runFor(500);
      await expect(shell).toHaveCount(0);
      await component.update({ props: { open: true } });
      await page.clock.runFor(500);
      await expect(shell).toHaveAttribute('data-reveal', '1');
      await component.update({ props: { open: false } });
      await page.clock.runFor(32);
      const closing = await frame();
      expect(closing.reveal).toBeLessThan(1);
      await component.update({ props: { open: true } });
      expect(await frame()).toEqual(closing);
      await page.clock.runFor(Math.ceil(1000 / hz));
      const turningOpen = await frame();
      expect(turningOpen.reveal).toBeLessThan(closing.reveal);
      const samples = [opening.reveal, turningClosed.reveal, closing.reveal, turningOpen.reveal];
      for (let i = 0; i < 32; i++) {
        await page.clock.runFor(16);
        const next = await frame();
        expect(next.width).toBeCloseTo(400, 3);
        expect(next.height).toBeCloseTo(420, 3);
        expect(next.y).toBeCloseTo(opening.y, 3);
        samples.push(next.reveal);
      }
      await expect(shell).toHaveAttribute('data-reveal', '1');
      expect(samples.every((value) => value >= 0 && value <= 1)).toBe(true);
      const full = await frame();
      expect(full.x).toBeLessThan(opening.x);
      await shot(page, `edge-slide-open-${hz}hz`);
      results.push({ hz, opening: cadenceProgress, samples });
      await component.update({ props: { open: false } });
      await page.clock.runFor(500);
      await expect(shell).toHaveCount(0);
      const state = JSON.parse((await component.getAttribute('data-state'))!);
      expect(state).toMatchObject({ held: false, reveal: 0, shell: null });
      await component.unmount();
    }
    expect(Math.abs(results[0].opening - results[1].opening)).toBeLessThan(0.03);
    await test.info().attach('edge-reversal-cadence.json', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });
  });

  test('edge reduced motion fades in 200 ms without translation and releases hidden input regions', async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    const now = new Date('2026-11-06T12:00:00Z');
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now);
    const component = await mount(DockEdgeMotionHarness);
    await component.update({ props: { open: true } });
    const shell = component.getByTestId('dock-edge-shell');
    const frame = () =>
      shell.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          opacity: Number(getComputedStyle(node).opacity),
        };
      });
    await page.clock.runFor(80);
    await expect.poll(async () => (await frame()).opacity).toBeGreaterThan(0);
    const partial = await frame();
    expect(partial.opacity).toBeGreaterThan(0);
    expect(partial.opacity).toBeLessThan(1);
    await page.clock.runFor(160);
    await expect(shell).toHaveCSS('opacity', '1');
    const full = await frame();
    expect(full).toEqual({ ...partial, opacity: 1 });
    await shot(page, 'edge-reduced-motion-open');
    await component.update({ props: { open: false } });
    await page.clock.runFor(80);
    await expect.poll(async () => (await frame()).opacity).toBeLessThan(1);
    const fading = await frame();
    expect(fading).toEqual({ ...full, opacity: fading.opacity });
    expect(fading.opacity).toBeGreaterThan(0);
    expect(fading.opacity).toBeLessThan(1);
    await page.clock.runFor(160);
    await expect(shell).toHaveCount(0);
    const state = JSON.parse((await component.getAttribute('data-state'))!);
    expect(state).toMatchObject({ held: false, reveal: 0, shell: null });
    await expect(component).toHaveAttribute('data-regions', '[]');
  });
});

test('a click opens a side conversation ready to type; hover previews over it; a click replaces it', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const side = await mountSide(mount, page);
  const entries = side.locator('[data-dock-entry]');
  const current = side.locator('[data-dock-entry][aria-current="true"]');
  const shell = side.getByTestId('dock-edge-shell');
  const preview = side.getByTestId('dock-preview');
  const [first, second] = [
    await entries.nth(1).getAttribute('data-dock-entry'),
    await entries.nth(2).getAttribute('data-dock-entry'),
  ];
  await entries.nth(1).click();
  await expect(current).toHaveAttribute('data-dock-entry', first!);
  await expect(shell).toHaveAttribute('data-reveal', '1');
  // Opened by a click, the composer has focus; the side dock shows no back button.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.activeElement?.matches(
            'textarea, [contenteditable="true"], [contenteditable="true"] *',
          ),
      ),
    )
    .toBe(true);
  await expect(side.locator('[data-dock-conversation-back]')).toBeHidden();
  // Hovering another entry previews it over the open box without switching.
  await entries.nth(2).hover();
  await expect(preview).toHaveAttribute('data-preview-workspace-id', second!);
  await expect(current).toHaveAttribute('data-dock-entry', first!);
  const covered = await preview.evaluate((card) => {
    const r = card.getBoundingClientRect();
    return (
      document
        .elementFromPoint(r.x + r.width / 2, r.y + 12)
        ?.closest('[data-testid="dock-preview"]') === card
    );
  });
  expect(covered).toBe(true);
  await shot(page, 'dock-edge-hover-preview');
  // The open entry never previews itself.
  await entries.nth(1).hover();
  await expect(preview).toHaveCount(0);
  // A click replaces the open conversation.
  await entries.nth(2).click();
  await expect(current).toHaveAttribute('data-dock-entry', second!);
  await expect(shell).toHaveAttribute('data-reveal', '1');
});
