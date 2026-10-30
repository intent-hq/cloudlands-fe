import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview, adaptiveDockFixture } from './dock-rail.preview-fixtures';
import {
  dockLocalRect,
  dockWindowEnvelope,
  resolveDockSurface,
  type DockDisplayGeometry,
  type DockPlacementSnapshot,
} from '$shared/dock-placement';

// The open/close video is a review artifact (copied to .intent/artifacts after the run).
test.use({ video: { mode: 'on', size: { width: 1000, height: 700 } } });

const ARTIFACTS = resolve(process.cwd(), '../../.intent/artifacts');

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: resolve(ARTIFACTS, `${name}.png`) });
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
  await side.locator('[data-dock-entry]').first().click();
  const shell = side.getByTestId('dock-edge-shell');
  await expect(shell).toHaveAttribute('data-reveal', '1');
  const panel = side.getByTestId('dock-conversation-surface');
  await expect(panel).toBeVisible();
  // The rail keeps its size, position and avatars while the conversation is open.
  expect(await rail.boundingBox()).toEqual(railBefore);
  await expect(rail).toHaveCSS('opacity', '1');
  await expect(side.locator('[data-dock-entry]').first()).toBeVisible();
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
  test('side shell grows from the entry and shrinks back on close', async ({ mount, page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
    await page.clock.install();
    const side = await mountSide(mount, page);
    await page.clock.runFor(100);
    await shot(page, 'dock-edge-closed');
    await side.locator('[data-dock-entry]').first().click();
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
    expect(regions.reveal).toBeGreaterThan(0.2);
    expect(regions.reveal).toBeLessThan(1);
    expect(regions.regions.length).toBeGreaterThan(0);
    // Shell/rail regions are window-local; measured conversation regions are viewport-local.
    // Neither may claim the transparent part of the final panel during opening.
    const bounds = [regions.shell, regions.rail].flatMap((box) => [
      box,
      { ...box, x: box.x - regions.host.x, y: box.y - regions.host.y },
    ]);
    for (const region of regions.regions)
      expect(
        bounds.some(
          (box) =>
            region.x >= box.x - 1 &&
            region.y >= box.y - 1 &&
            region.x + region.width <= box.x + box.width + 1 &&
            region.y + region.height <= box.y + box.height + 1,
        ),
      ).toBe(true);
    await shot(page, 'dock-edge-mid');
    await testInfo.attach('side-shell-streaming-frame.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
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

  test('the box grows out of the hovered card, sits on its entry, and shrinks back into the card', async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
    // The clock owns every frame from mount on, so each read sees one frame.
    await page.clock.install();
    const side = await mountSide(mount, page);
    await page.clock.runFor(100);
    const entries = side.locator('[data-dock-entry]');
    const entry = entries.nth(2);
    const preview = side.getByTestId('dock-preview');
    const shell = side.getByTestId('dock-edge-shell');
    await entry.hover();
    for (let i = 0; i < 60 && !(await preview.isVisible()); i += 1) await page.clock.runFor(16);
    await page.clock.runFor(200);
    await expect(preview).toHaveCSS('opacity', '1');
    // The card's content may still settle (its height, so its centred top): wait until
    // its rect holds still, then click it as measured.
    let card = (await preview.boundingBox())!;
    for (let i = 0; i < 30; i += 1) {
      await page.clock.runFor(50);
      await page.waitForTimeout(50);
      const next = (await preview.boundingBox())!;
      const still = (['x', 'y', 'width', 'height'] as const).every(
        (key) => Math.abs(next[key] - card[key]) < 0.5,
      );
      card = next;
      if (still) break;
    }
    const cardRadius = await preview.evaluate((node) =>
      parseFloat(getComputedStyle(node).borderTopLeftRadius),
    );
    await entry.click();
    // One DOM read per frame (rect, reveal and radius together; null while there is no box).
    const frameOf = () =>
      page.evaluate(() => {
        const node = document.querySelector('[data-testid="dock-edge-shell"]');
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return {
          box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          reveal: Number(node.getAttribute('data-reveal')),
          opacity: Number(getComputedStyle(node).opacity),
          radius: parseFloat(getComputedStyle(node).borderTopLeftRadius),
        };
      });
    // Step frames until the box exists: its first frame is the card (rect and radius),
    // and from then on the card is gone, never shown together with the box.
    let start = await frameOf();
    for (let i = 0; i < 200 && !start; i += 1) {
      await page.clock.runFor(4);
      start = await frameOf();
    }
    const { box: first, reveal: firstReveal, radius: firstRadius } = start!;
    await page.clock.runFor(16);
    await expect(preview).toHaveCount(0);
    await shot(page, 'dock-edge-card-morph-start');
    const reveal = async () =>
      Number((await shell.getAttribute('data-reveal').catch(() => null)) ?? 0);
    let mid = 0;
    for (let i = 0; i < 160 && (await reveal()) < 1; i += 1) {
      await page.clock.runFor(16);
      await page.waitForTimeout(16);
      if (!mid && (await reveal()) >= 0.45) {
        mid = await reveal();
        await shot(page, 'dock-edge-card-morph-mid');
        await expect(preview).toHaveCount(0);
      }
    }
    await expect(shell).toHaveAttribute('data-reveal', '1');
    const open = (await shell.boundingBox())!;
    // The first frame is the card, blended toward the panel by the reveal it showed.
    const lerp = (a: number, b: number) => a + (b - a) * firstReveal;
    expect(Math.abs(first.x - lerp(card.x, open.x))).toBeLessThanOrEqual(2);
    expect(Math.abs(first.y - lerp(card.y, open.y))).toBeLessThanOrEqual(2);
    expect(Math.abs(first.width - lerp(card.width, open.width))).toBeLessThanOrEqual(2);
    expect(Math.abs(first.height - lerp(card.height, open.height))).toBeLessThanOrEqual(2);
    // Observed early in the open (the fake clock may land past the very first frame).
    expect(firstReveal).toBeLessThan(0.5);
    expect(Math.abs(firstRadius - (cardRadius + (32 - cardRadius) * firstReveal))).toBeLessThan(1);
    // Vertically it sits on its entry like the card does: centred on it, unless that
    // would leave the work area (24..700 on this display, 8 px inset), then clamped.
    const item = (await entry.boundingBox())!;
    const centred = Math.abs(open.y + open.height / 2 - (item.y + item.height / 2)) <= 1;
    const clamped =
      Math.abs(open.y - (24 + 8)) <= 1 || Math.abs(open.y + open.height - (700 - 8)) <= 1;
    expect(centred || clamped).toBe(true);
    expect(open.y).toBeGreaterThanOrEqual(24 + 8 - 1);
    expect(open.y + open.height).toBeLessThanOrEqual(700 - 8 + 1);
    // Main owns the rect: resize handles and pointer regions follow it.
    const host = (await side.locator('.dock-preview-host').boundingBox())!;
    await expect
      .poll(async () => {
        const regions: { x: number; y: number; width: number; height: number }[] =
          JSON.parse((await side.getAttribute('data-preview-pointer')) ?? '{}').regions ?? [];
        return regions.some(
          (r) => Math.abs(r.y - (open.y - host.y)) <= 1 && Math.abs(r.height - open.height) <= 1,
        );
      })
      .toBe(true);
    await shot(page, 'dock-edge-card-morph-open');
    // Close: back into the card's rect, fading only at the very end.
    await page.clock.runFor(300);
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    let late: Awaited<ReturnType<typeof frameOf>> = null;
    for (let i = 0; i < 120; i += 1) {
      await page.clock.runFor(16);
      await page.waitForTimeout(16);
      const frame = await frameOf();
      if (!frame) break;
      if (frame.reveal > 0 && frame.reveal < 0.15) late = frame;
    }
    await expect(shell).toHaveCount(0);
    expect(late).not.toBeNull();
    const back = (a: number, b: number) => a + (b - a) * late!.reveal;
    expect(Math.abs(late!.box.y - back(card.y, open.y))).toBeLessThanOrEqual(2);
    expect(Math.abs(late!.box.height - back(card.height, open.height))).toBeLessThanOrEqual(2);
    expect(late!.opacity).toBeLessThan(1);
    await page.clock.runFor(300);
    await page.waitForTimeout(300);
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
