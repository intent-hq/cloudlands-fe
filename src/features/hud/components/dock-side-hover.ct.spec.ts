import { writeFile } from 'node:fs/promises';
import { PullRequestStatus } from '$shared/types';
import { expect, test } from '../../../test/ct-test';
import {
  dockLocalRect,
  dockWindowEnvelope,
  type DockDisplayGeometry,
} from '$shared/dock-placement';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

test.use({ video: { mode: 'on', size: { width: 720, height: 720 } } });

for (const side of ['left', 'right'] as const) {
  test(`side-only ${side} rail hovercards and keyboard previews`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 720, height: 720 });
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
    await page.mouse.move(700, 690);
    const props = dockRailPreview.states[`side-${side}`].props;
    const workspaces = props.workspaces.slice(0, 2);
    const component = await mount(DockRailPreview, {
      props: { ...props, workspaces, theme: 'dark' },
    });
    const entries = component.locator('[data-dock-entry]');
    const card = component.getByTestId('dock-preview');
    const evidence: unknown[] = [];
    const assertRegions = async () => {
      await expect
        .poll(async () =>
          component.evaluate((host) => {
            const state = JSON.parse(host.getAttribute('data-preview-pointer') ?? '{}') as {
              regions?: { x: number; y: number; width: number; height: number }[];
            };
            const targets = [
              ...host.querySelectorAll<HTMLElement>(
                '[data-dock-entry], [data-testid="dock-preview"]',
              ),
            ];
            const bounds = host.getBoundingClientRect();
            return targets.every((el) => {
              const b = el.getBoundingClientRect();
              return (
                b.left >= bounds.left - 0.5 &&
                b.right <= bounds.right + 0.5 &&
                b.top >= bounds.top - 0.5 &&
                b.bottom <= bounds.bottom + 0.5 &&
                state.regions?.some(
                  (r) =>
                    r.x <= b.left + 0.5 &&
                    r.y <= b.top + 0.5 &&
                    r.x + r.width >= b.right - 0.5 &&
                    r.y + r.height >= b.bottom - 0.5,
                )
              );
            });
          }),
        )
        .toBe(true);
    };
    await expect(entries).toHaveCount(3);
    await expect(entries.first().locator('[data-dock-workspace-avatar]')).toHaveCount(0);
    // The workspace's state shows on its avatar, as in the app (no separate status dot).
    for (const [index, [status, avatarState]] of [
      ['failed', 'failed'],
      ['blocked', 'attention-blocker'],
    ].entries()) {
      await expect(
        entries
          .nth(index + 1)
          .locator(
            `[data-dock-workspace-avatar][data-workspace-status="${status}"] [data-agent-avatar-with-state]`,
          ),
      ).toHaveAttribute('data-avatar-state', avatarState);
      await expect(entries.nth(index + 1)).toHaveAccessibleDescription(
        index === 0 ? 'Failed' : 'Blocked',
      );
    }
    await expect(component.getByTestId('dock-overview')).toHaveCount(0);
    await expect(component.getByTestId('dock-dismiss')).toHaveCount(0);
    await entries.nth(1).hover();
    await expect(card).toHaveAttribute(
      'data-preview-workspace-id',
      String(workspaces[0].workspace.id),
    );
    await expect(card).toBeVisible();
    await expect
      .poll(async () =>
        entries.evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-dock-scale')))),
      )
      .toEqual([1.15, 1.35, 1.15]);
    await assertRegions();
    const scaleRects = await entries.evaluateAll((els) =>
      els.map((el) => ({
        scale: el.getAttribute('data-dock-scale'),
        rect: el.getBoundingClientRect().toJSON(),
        transform: getComputedStyle(el).transform,
      })),
    );
    evidence.push({ normalMotion: scaleRects });
    const hovered = await entries.nth(1).boundingBox();
    const cardBox = await card.boundingBox();
    if (!hovered || !cardBox) throw new Error('Missing hovercard or hovered icon');
    const cardX = side === 'left' ? cardBox.x + 6 : cardBox.x + cardBox.width - 6;
    await page.mouse.move(cardX, hovered.y + hovered.height / 2, { steps: 12 });
    await expect(card).toHaveAttribute(
      'data-preview-workspace-id',
      String(workspaces[0].workspace.id),
    );
    await expect(card).toContainText(workspaces[0].workspace.title ?? '');
    // The card is a preview only: no feedback action of its own.
    await expect(card.getByRole('button')).toHaveCount(0);
    await entries.nth(2).hover();
    await expect(card).toHaveAttribute(
      'data-preview-workspace-id',
      String(workspaces[1].workspace.id),
    );
    await entries.first().hover();
    await expect(card).toHaveAttribute('data-preview-workspace-id', 'dock:assistant');
    await expect(card).toContainText('Assistant');
    await page.mouse.move(700, 690);
    await expect(card).toHaveCount(0);
    const closedPng = testInfo.outputPath(`side-${side}-pointer-mouseout.png`);
    await component.screenshot({ path: closedPng });
    await entries.nth(1).click();
    await expect(component).toHaveAttribute(
      'data-preview-action',
      `workspace:${workspaces[0].workspace.id}`,
    );
    await entries.nth(1).hover();
    await page.mouse.down();
    await expect(entries.nth(1)).toBeFocused();
    await page.mouse.move(700, 690);
    await expect(card).toHaveCount(0);
    await expect(entries.nth(1)).not.toBeFocused();
    await page.mouse.up();
    evidence.push({
      pointerIconMouseout:
        'pointer-down focus released on mouseout; ordinary navigation target passed',
    });
    await page.keyboard.press('Tab');
    await entries.nth(2).focus();
    await expect(card).toHaveAttribute(
      'data-preview-workspace-id',
      String(workspaces[1].workspace.id),
    );
    await expect(card).toBeVisible();
    await expect(entries.nth(2)).toBeFocused();
    evidence.push({
      beforeKeyboardEscape: await card.evaluate((el) => ({
        visibility: getComputedStyle(el).visibility,
        focused: document.activeElement?.getAttribute('data-dock-entry'),
        rect: el.getBoundingClientRect().toJSON(),
      })),
    });
    await writeFile(
      testInfo.outputPath(`side-${side}-progress.json`),
      JSON.stringify(evidence, null, 2),
    );
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(component.getByTestId('dock-shell')).toBeVisible();
    await entries.first().focus();
    await entries.first().press('ArrowDown');
    await expect(entries.nth(1)).toBeFocused();
    await expect(card).toHaveAttribute(
      'data-preview-workspace-id',
      String(workspaces[0].workspace.id),
    );
    await assertRegions();
    const png = testInfo.outputPath(`side-${side}-hovercard.png`);
    await component.screenshot({ path: png });
    await testInfo.attach(`${side} workspace card`, { path: png, contentType: 'image/png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await entries.nth(1).hover();
    await expect
      .poll(async () =>
        entries.evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-dock-scale')))),
      )
      .toEqual([1, 1, 1]);
    await assertRegions();
    evidence.push({
      reducedMotion: await entries.evaluateAll((els) =>
        els.map((el) => ({
          scale: el.getAttribute('data-dock-scale'),
          transform: getComputedStyle(el).transform,
        })),
      ),
      actions: await component.getAttribute('data-preview-actions'),
      regions: await component.getAttribute('data-preview-pointer'),
    });
    await component.unmount();

    const display: DockDisplayGeometry = {
      id: 7,
      bounds: { x: -1600, y: -900, width: 640, height: 640 },
      workArea: { x: -1590, y: -868, width: 620, height: 596 },
      cutout: null,
    };
    for (const edge of ['top', 'bottom'] as const) {
      const surface = {
        x: side === 'left' ? -1590 : -1010,
        y: edge === 'top' ? -890 : -416,
        width: 40,
        height: 144,
      };
      const windowBounds = dockWindowEnvelope(surface, display, null, side, true);
      if (!props.placement) throw new Error('Missing side placement fixture');
      const placement = {
        ...props.placement,
        revision: 40,
        placement: { kind: 'edge' as const, displayId: 7, side, along: edge === 'top' ? 0 : 1 },
        displayId: 7,
        windowBounds,
        surface: dockLocalRect(surface, windowBounds),
      };
      await page.mouse.move(700, 690);
      const host = await mount(DockRailPreview, {
        props: {
          ...props,
          workspaces,
          placement,
          viewportWidth: windowBounds.width,
          viewportHeight: windowBounds.height,
          theme: 'dark',
        },
      });
      const target = host.locator('[data-dock-entry]').nth(edge === 'top' ? 0 : 2);
      await target.hover();
      const preview = host.getByTestId('dock-preview');
      await expect(preview).toBeVisible();
      const bounds = await host.boundingBox();
      const rendered = await preview.boundingBox();
      const rail = await host.getByTestId('dock-surface').boundingBox();
      if (!bounds || !rendered || !rail) throw new Error('Missing offset-display geometry');
      expect(rendered.y).toBeGreaterThanOrEqual(bounds.y);
      expect(rendered.y + rendered.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      expect(rail.height).toBe(144);
      expect(rail.y - bounds.y).toBe(surface.y - windowBounds.y);
      expect(windowBounds.y).toBeLessThanOrEqual(display.workArea.y);
      expect(windowBounds.y + windowBounds.height).toBeGreaterThanOrEqual(
        display.workArea.y + display.workArea.height,
      );
      evidence.push({ edge, display, surface, windowBounds, rendered, rail });
      const path = testInfo.outputPath(`side-${side}-${edge}-offset.png`);
      await host.screenshot({ path });
      await host.unmount();
    }
    await writeFile(
      testInfo.outputPath(`side-${side}-evidence.json`),
      JSON.stringify(
        {
          evidence,
          scope:
            'browser components and production geometry with synthetic display; observed region publication only, not native OS click-through',
        },
        null,
        2,
      ),
    );
  });
}

test('tall side cards fit production envelope at offset display boundaries', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const evidence: unknown[] = [];
  for (const side of ['left', 'right'] as const) {
    const props = dockRailPreview.states[`side-${side}`].props;
    const workspaces = props.workspaces.slice(0, 2).map((item) => ({
      ...item,
      workspace: {
        ...item.workspace,
        statusMessage:
          'Review the capture flow, keyboard navigation, and destination before shipping. '.repeat(
            5,
          ),
        pullRequests: Array.from({ length: 6 }, (_, index) => ({
          id: `fixture-pr-${index}`,
          number: index + 1,
          url: `https://example.test/fixture/pull/${index + 1}`,
          title: `Fixture review ${index + 1}`,
          status: PullRequestStatus.Open,
          createdAt: '2026-10-20T12:00:00Z',
          updatedAt: '2026-10-20T12:00:00Z',
        })),
      },
    }));
    const display: DockDisplayGeometry = {
      id: 7,
      bounds: { x: -1600, y: -900, width: 640, height: 640 },
      workArea: { x: -1590, y: -868, width: 620, height: 596 },
      cutout: null,
    };
    for (const edge of ['top', 'bottom'] as const) {
      const surface = {
        x: side === 'left' ? -1590 : -1010,
        y: edge === 'top' ? -890 : -416,
        width: 40,
        height: 144,
      };
      const windowBounds = dockWindowEnvelope(surface, display, null, side, true);
      if (!props.placement) throw new Error('Missing side fixture');
      const placement = {
        ...props.placement,
        revision: 50,
        placement: { kind: 'edge' as const, displayId: 7, side, along: edge === 'top' ? 0 : 1 },
        displayId: 7,
        windowBounds,
        surface: dockLocalRect(surface, windowBounds),
      };
      await page.mouse.move(700, 690);
      const host = await mount(DockRailPreview, {
        props: {
          ...props,
          workspaces,
          placement,
          viewportWidth: windowBounds.width,
          viewportHeight: windowBounds.height,
          theme: 'dark',
        },
      });
      await host
        .locator('[data-dock-entry]')
        .nth(edge === 'top' ? 1 : 2)
        .hover();
      const card = host.getByTestId('dock-preview');
      await expect(card).toBeVisible();
      await expect(card.locator('[data-workspace-hover-card-pr-list]')).toBeVisible();
      const b = await host.boundingBox();
      const c = await card.boundingBox();
      if (!b || !c) throw new Error('Missing tall card geometry');
      expect(c.height).toBeGreaterThan(192);
      expect(c.y).toBeGreaterThanOrEqual(b.y);
      expect(c.y + c.height).toBeLessThanOrEqual(b.y + b.height);
      await expect
        .poll(async () => {
          const state = JSON.parse((await host.getAttribute('data-preview-pointer')) ?? '{}') as {
            regions: { x: number; y: number; width: number; height: number }[];
          };
          return state.regions.some(
            (r) =>
              r.x <= c.x + 0.5 &&
              r.y <= c.y + 0.5 &&
              r.x + r.width >= c.x + c.width - 0.5 &&
              r.y + r.height >= c.y + c.height - 0.5,
          );
        })
        .toBe(true);
      const png = testInfo.outputPath(`side-${side}-${edge}-tall.png`);
      await host.screenshot({ path: png });
      evidence.push({ side, edge, surface, windowBounds, card: c });
      await host.unmount();
    }
  }
  await writeFile(testInfo.outputPath('tall-envelope.json'), JSON.stringify(evidence, null, 2));
});
