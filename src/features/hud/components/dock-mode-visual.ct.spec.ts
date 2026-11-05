import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview, adaptiveDockFixture } from './dock-rail.preview-fixtures';
import {
  resolveFloatingDockGeometry,
  dockWindowEnvelope,
  dockLocalRect,
  DOCK_FLOATING_COMPACT_SIZE,
  DOCK_FLOATING_SHADOW_MARGIN,
  type DockDisplayGeometry,
} from '$shared/dock-placement';

test('floating companion supports keyboard navigation and Assistant activation', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 680 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  await page.mouse.move(700, 660);
  // Mirror native floating geometry: without a display the preview falls back to a
  // re-centred, anchorless surface that jumps the grip out from under the pointer.
  const display: DockDisplayGeometry = {
    id: 1,
    bounds: { x: 0, y: 0, width: 640, height: 600 },
    workArea: { x: 0, y: 0, width: 640, height: 600 },
    cutout: null,
  };
  const target = { kind: 'floating', displayId: 1, x: 0.5, y: 0.5 } as const;
  const geometry = resolveFloatingDockGeometry(target, display, DOCK_FLOATING_COMPACT_SIZE);
  const windowBounds = dockWindowEnvelope(
    geometry.surface,
    display,
    null,
    null,
    true,
    DOCK_FLOATING_SHADOW_MARGIN,
  );
  const props = dockRailPreview.states.floating.props;
  const component = await mount(DockRailPreview, {
    props: {
      ...props,
      workspaces: props.workspaces.slice(0, 2),
      placement: {
        ...adaptiveDockFixture('floating'),
        placement: target,
        windowBounds,
        surface: dockLocalRect(geometry.surface, windowBounds),
        workArea: dockLocalRect(display.workArea, windowBounds),
        floatingAnchor: dockLocalRect(geometry.anchor, windowBounds),
        expansionDirection: geometry.expansionDirection,
      },
      floatingDisplay: display,
      viewportWidth: 640,
      viewportHeight: 600,
    },
  });
  const shell = component.getByTestId('dock-shell');
  const grip = component.getByTestId('dock-drag-handle');
  // The Assistant row (pinned below the list) stands in for any focusable row control.
  const pen = component.locator('[data-dock-row][data-workspace-id="dock:assistant"]');
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await expect(component.getByTestId('dock-dismiss')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(grip).toBeFocused();
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await expect(component.locator('.overview-frame')).not.toHaveAttribute('inert', '');
  await expect(pen).toBeVisible();
  await grip.press('Tab');
  await expect(component.locator('.overview-frame :focus')).toHaveCount(1);
  await pen.focus();
  await expect(pen).toBeFocused();
  await pen.press('Enter');
  await expect(component).toHaveAttribute('data-preview-action', 'assistant');
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await component.locator('[data-dock-row]').last().focus();
  await page.keyboard.press('Tab');
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await expect(shell).toBeVisible();
  await expect(component.getByTestId('dock-dismiss')).toHaveCount(0);
  await component.unmount();
});

for (const mode of ['side-left', 'side-right', 'floating', 'notch'] as const) {
  test(`adaptive action failure audit retains visible recovery controls: ${mode}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 900, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    const evidence: unknown[] = [];
    await page.mouse.move(850, 690);
    const props = dockRailPreview.states[mode].props;
    const component = await mount(DockRailPreview, {
      props: {
        ...props,
        workspaces: props.workspaces.slice(0, 2),
        failOpenOnce: true,
        theme: 'dark',
      },
    });
    if (mode.startsWith('side-')) {
      await component.locator('[data-dock-entry]').nth(0).click();
    } else {
      await component.getByTestId('dock-drag-handle').focus();
      await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
      await component.locator('[data-dock-row]').nth(1).click();
    }
    const feedback = component.locator('[data-dock-action-feedback]');
    await expect(feedback.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    const recoveryGeometry = () =>
      feedback.evaluate((el) => {
        const host = el.closest('[data-dock-rail-preview]');
        const content = host?.querySelector('.companion-content');
        if (!host || !content) throw new Error('Missing recovery host or visible core');
        const r = content.getBoundingClientRect();
        const offsets = (
          getComputedStyle(content)
            .clipPath.split('round')[0]
            .match(/[\d.]+/g) ?? []
        ).map(Number);
        const [top = 0, right = top, bottom = top, left = right] = offsets;
        const core = new DOMRect(
          r.x + left,
          r.y + top,
          r.width - left - right,
          r.height - top - bottom,
        );
        const error = el.getBoundingClientRect();
        return {
          error: error.toJSON(),
          core: core.toJSON(),
          host: host.getBoundingClientRect().toJSON(),
          gap: Math.hypot(
            Math.max(core.left - error.right, error.left - core.right, 0),
            Math.max(core.top - error.bottom, error.top - core.bottom, 0),
          ),
        };
      });
    await expect.poll(async () => (await recoveryGeometry()).gap).toBeLessThanOrEqual(16);
    const geometry = await recoveryGeometry();
    expect(geometry.error.left).toBeGreaterThanOrEqual(geometry.host.left);
    expect(geometry.error.right).toBeLessThanOrEqual(geometry.host.right);
    expect(geometry.error.top).toBeGreaterThanOrEqual(geometry.host.top);
    expect(geometry.error.bottom).toBeLessThanOrEqual(geometry.host.bottom);
    const coverageSamples: unknown[] = [];
    try {
      await expect
        .poll(
          async () => {
            const sample = await feedback.evaluate((el) => {
              const host = el.closest('[data-dock-rail-preview]');
              if (!host) throw new Error('Missing recovery host');
              const pointer = JSON.parse(
                host.getAttribute('data-preview-pointer') ?? '{"regions":[]}',
              ) as {
                revision?: number;
                regions: { x: number; y: number; width: number; height: number }[];
              };
              const r = el.getBoundingClientRect();
              return {
                time: performance.now(),
                pointer,
                feedback: r.toJSON(),
                host: host.getBoundingClientRect().toJSON(),
                position: el.parentElement?.getAttribute('style'),
                covered: pointer.regions.some(
                  (region) =>
                    region.x <= r.x + 0.5 &&
                    region.y <= r.y + 0.5 &&
                    region.x + region.width >= r.x + r.width - 0.5 &&
                    region.y + region.height >= r.y + r.height - 0.5,
                ),
              };
            });
            coverageSamples.push(sample);
            return sample.covered;
          },
          { message: 'Published pointer region must cover the visible recovery controls' },
        )
        .toBe(true);
    } finally {
      await testInfo.attach(`${mode}-recovery-pointer-coverage.json`, {
        body: JSON.stringify(coverageSamples, null, 2),
        contentType: 'application/json',
      });
    }
    await component.screenshot({ path: testInfo.outputPath(`${mode}-action-error.png`) });
    evidence.push({
      mode,
      geometry,
      feedback: await feedback.boundingBox(),
      surface: await component.getByTestId('dock-surface').boundingBox(),
      pointer: await component.getAttribute('data-preview-pointer'),
    });
    await feedback.getByRole('button', { name: 'Retry', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(feedback).toHaveCount(0);
    await expect(component).toHaveAttribute('data-preview-action', /^(workspace:|assistant)/);
    await component.unmount();
    await page.mouse.move(850, 690);
    const errorProps = { ...props, workspaces: props.workspaces.slice(0, 2), placementError: true };
    const placement = await mount(DockRailPreview, { props: errorProps });
    const notice = placement.locator('[data-dock-action-feedback]');
    await expect(notice.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await placement.screenshot({ path: testInfo.outputPath(`${mode}-placement-error.png`) });
    await notice.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(notice).toHaveCount(0);
    await placement.getByTestId('dock-drag-handle').focus();
    await expect(notice).toHaveCount(0);
    await placement.update({ props: { ...errorProps, placementError: false } });
    await placement.update({ props: errorProps });
    await expect(notice.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await placement.unmount();
    await writeFile(
      testInfo.outputPath('action-error-audit.json'),
      JSON.stringify(evidence, null, 2),
    );
  });
}

test('notch keyboard focus request and grip retain internal Tab navigation', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 680 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const focusRequest of [0, 1]) {
    await page.mouse.move(700, 660);
    const props = dockRailPreview.states.notch.props;
    const component = await mount(DockRailPreview, {
      props: { ...props, workspaces: props.workspaces.slice(0, 2), focusRequest },
    });
    const shell = component.getByTestId('dock-shell');
    const row = component.locator('[data-dock-row]').first();
    if (!focusRequest) {
      await expect(shell).toHaveAttribute('data-expanded', 'false');
      await page.keyboard.press('Tab');
      await expect(component.getByTestId('dock-drag-handle')).toBeFocused();
      await expect(shell).toHaveAttribute('data-reveal', '1');
      await page.keyboard.press('Tab');
      await expect(component.getByTestId('dock-dismiss')).toHaveCount(0);
    }
    await expect(row).toBeFocused();
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await page.keyboard.press('Tab');
    // Rows have no feedback pen: Tab moves to the next row.
    const next = component.locator('[data-dock-row]').nth(1);
    await expect(next).toBeFocused();
    await expect(shell).toHaveAttribute('data-expanded', 'true');
    await next.press('Enter');
    await expect(component).toHaveAttribute(
      'data-preview-action',
      `workspace:${await next.getAttribute('data-workspace-id')}`,
    );
    await expect(component.getByTestId('dock-dismiss')).toHaveCount(0);
    await component.screenshot({ path: testInfo.outputPath(`notch-keyboard-${focusRequest}.png`) });
    await page.keyboard.press('Escape');
    await expect
      .poll(
        async () =>
          JSON.parse((await component.getAttribute('data-preview-commands')) ?? '[]').at(-1)
            ?.action,
      )
      .toBe('dismiss');
    await component.unmount();
  }
});
