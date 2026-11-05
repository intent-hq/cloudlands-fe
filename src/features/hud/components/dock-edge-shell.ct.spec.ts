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

test('a click opens a side conversation ready to type and another click replaces it', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const side = await mountSide(mount, page);
  const entries = side.locator('[data-dock-entry]');
  const current = side.locator('[data-dock-entry][aria-current="true"]');
  const shell = side.getByTestId('dock-edge-shell');
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
  // A click replaces the open conversation.
  await entries.nth(2).click();
  await expect(current).toHaveAttribute('data-dock-entry', second!);
  await expect(shell).toHaveAttribute('data-reveal', '1');
});
