import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview, adaptiveDockFixture } from './dock-rail.preview-fixtures';
import {
  resolveFloatingDockGeometry,
  floatingDockPlacement,
  resolveDockSurface,
  dockWindowEnvelope,
  dockLocalRect,
  DOCK_FLOATING_COMPACT_SIZE,
  DOCK_FLOATING_SHADOW_MARGIN,
  type DockDisplayGeometry,
  type DockPlacementSnapshot,
} from '$shared/dock-placement';

if (process.env.COMPANION_DEMO === '1') {
  test.use({
    video: { mode: 'on', size: { width: 1280, height: 800 } },
    viewport: { width: 1280, height: 800 },
    contextOptions: { reducedMotion: 'no-preference' },
  });
}

test.describe('companion handoff recording', () => {
  test('real-speed companion hover tour', async ({ mount, page }, testInfo) => {
    test.skip(process.env.COMPANION_DEMO !== '1', 'Opt-in handoff recording');
    test.setTimeout(60_000);
    await page.addStyleTag({
      content: '[data-dock-rail-preview] { margin: 80px auto; } body { background: #171717; }',
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Deliberate reading pauses belong only to this opt-in video, never to test readiness.
    for (const mode of ['floating', 'side-right', 'notch'] as const) {
      await page.mouse.move(1100, 740);
      const props = dockRailPreview.states[mode].props;
      const component = await mount(DockRailPreview, {
        props: { ...props, theme: 'dark', workspaces: props.workspaces.slice(0, 2) },
      });
      await expect(component.getByTestId('dock-shell')).toBeVisible();
      await page.waitForTimeout(1500);
      if (mode === 'side-right') {
        const entries = component.locator('[data-dock-entry]');
        await entries.first().hover();
        await expect(component.getByTestId('dock-preview')).toBeVisible();
        await page.waitForTimeout(1800);
        await entries.nth(1).hover();
        await page.waitForTimeout(1800);
      } else {
        await component.getByTestId('dock-drag-handle').hover();
        await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
        await page.waitForTimeout(1500);
        await component.locator('.overview-row').first().hover();
        await page.waitForTimeout(1000);
      }
      await component.screenshot({ path: testInfo.outputPath(`${mode}-polished.png`) });
      await page.mouse.move(1100, 740);
      if (mode !== 'side-right') {
        await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '0');
        await component.getByTestId('dock-drag-handle').hover();
        await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
      }
      await page.waitForTimeout(1500);
      await component.unmount();
    }
    expect(errors).toEqual([]);
    await writeFile(
      testInfo.outputPath('demo-scope.json'),
      JSON.stringify(
        {
          synthetic: true,
          physicalInput: false,
          modes: ['floating', 'side-right', 'notch'],
          consoleErrors: errors,
        },
        null,
        2,
      ),
    );
  });
});

test('companion mode visuals with two workspace rows', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 720, height: 680 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const evidence: unknown[] = [];
  const after = process.env.DOCK_MODE_STAGE === 'after';
  const modes = ['notch', 'floating'] as const;
  const scenes = modes.map((mode) => ({ mode, theme: 'dark' as 'dark' | 'light' }));
  if (after) scenes.push({ mode: 'floating', theme: 'light' });
  for (const { mode, theme } of scenes) {
    await page.mouse.move(700, 660);
    const props = dockRailPreview.states[mode].props;
    const component = await mount(DockRailPreview, {
      props: { ...props, workspaces: props.workspaces.slice(0, 2), theme },
    });
    const shell = component.getByTestId('dock-shell');
    const capture = async (state: string) => {
      const label = theme === 'dark' ? mode : `${mode}-light`;
      const path = testInfo.outputPath(`${label}-${state}.png`);
      await component.screenshot({ path, animations: 'disabled' });
      await testInfo.attach(`${mode} ${state}`, { path, contentType: 'image/png' });
      const detail = testInfo.outputPath(`${label}-${state}-detail.png`);
      await component
        .getByTestId('dock-surface')
        .screenshot({ path: detail, animations: 'disabled' });
      const measurements = await shell.evaluate((el) => {
        const surface = el.querySelector('[data-testid="dock-surface"]');
        if (!surface) throw new Error('Missing rendered dock surface');
        const path = el.querySelector<SVGPathElement>('.shell-silhouette path');
        const host = el.closest('[data-dock-rail-preview]');
        if (!path || !host) throw new Error('Missing silhouette or preview host');
        const envelope = surface.getBoundingClientRect();
        const contentClip = getComputedStyle(
          el.querySelector('.companion-content') ?? surface,
        ).clipPath;
        const offsets = (contentClip.split('round')[0].match(/[\d.]+/g) ?? []).map(Number);
        const [top, right = top, bottom = top, left = right] = offsets;
        const bounds = new DOMRect(
          envelope.x + left,
          envelope.y + top,
          envelope.width - left - right,
          envelope.height - top - bottom,
        );
        const pathBox = path.getBBox();
        const side = el.getAttribute('data-side');
        const fill = [];
        for (let y = 0; y <= 20; y++)
          for (let x = 0; x <= 20; x++) {
            const px = pathBox.x + pathBox.width * (side === 'right' ? 1 - x / 20 : x / 20);
            fill.push(path.isPointInFill(new DOMPoint(px, pathBox.y + (pathBox.height * y) / 20)));
          }
        const lastRail = [...el.querySelectorAll('.side-rail button')].at(-1);
        const buttons = [
          ...el.querySelectorAll<HTMLElement>(
            '[data-dock-row], [data-testid="dock-drag-handle"], [data-testid="dock-dismiss"]',
          ),
        ].filter(
          (button) =>
            !button.closest('[inert]') && getComputedStyle(button).visibility !== 'hidden',
        );
        return {
          surface: bounds.toJSON(),
          envelope: envelope.toJSON(),
          host: host.getBoundingClientRect().toJSON(),
          pathBounds: path.getBoundingClientRect().toJSON(),
          pathBox: { x: pathBox.x, y: pathBox.y, width: pathBox.width, height: pathBox.height },
          fill,
          path: path.getAttribute('d'),
          svgPointerEvents: getComputedStyle(path).pointerEvents,
          contentClip,
          railBottomGap: lastRail ? bounds.bottom - lastRail.getBoundingClientRect().bottom : null,
          buttons: buttons.map((button) => ({
            name: button.getAttribute('aria-label'),
            rect: button.getBoundingClientRect().toJSON(),
          })),
          rows: [...el.querySelectorAll('.overview-row')].map((row) =>
            row.getBoundingClientRect().toJSON(),
          ),
        };
      });
      evidence.push({ mode, theme, state, measurements });
      await writeFile(testInfo.outputPath('mode-progress.json'), JSON.stringify(evidence, null, 2));
      if (after) {
        const { host, surface, pathBounds } = measurements;
        expect(pathBounds.left).toBeGreaterThanOrEqual(host.left - 0.5);
        expect(pathBounds.right).toBeLessThanOrEqual(host.right + 0.5);
        expect(pathBounds.top).toBeGreaterThanOrEqual(host.top - 0.5);
        expect(pathBounds.bottom).toBeLessThanOrEqual(host.bottom + 0.5);
        if (state === 'expanded') {
          for (const { rect } of measurements.buttons) {
            expect(rect.left).toBeGreaterThanOrEqual(surface.left - 0.5);
            expect(rect.right).toBeLessThanOrEqual(surface.right + 0.5);
            expect(rect.top).toBeGreaterThanOrEqual(surface.top - 0.5);
            expect(rect.bottom).toBeLessThanOrEqual(surface.bottom + 0.5);
          }
        }
      }
      return measurements;
    };
    await expect(shell).toHaveAttribute('data-expanded', 'false');
    await expect(shell).toHaveAttribute('data-reveal', '0');
    await capture('compact');
    await component.getByTestId('dock-drag-handle').hover();
    await expect(shell).toHaveAttribute('data-expanded', 'true');
    await expect(shell).toHaveAttribute('data-reveal', '1');
    // Rows carry title, status and time only: no per-row feedback pen.
    await expect(component.getByTestId('dock-row-feedback')).toHaveCount(0);
    await capture('expanded');
    if (after && (mode === 'notch' || mode === 'floating')) {
      await expect(
        component.locator('.companion-header [data-testid="dock-update-count"]'),
      ).toHaveCount(1);
      await expect(component.locator('.companion-header img')).toHaveCount(0);
    }
    await expect(component.getByTestId('dock-dismiss')).toHaveCount(0);
    if (after) {
      for (const item of props.workspaces.slice(0, 2)) {
        const id = String(item.workspace.id);
        await component.locator(`[data-dock-row][data-workspace-id="${id}"]`).click();
        await expect(component).toHaveAttribute('data-preview-action', `workspace:${id}`);
      }
      const assistant = component.locator('[data-dock-row][data-workspace-id="dock:assistant"]');
      await page.keyboard.press('Tab');
      await component.getByTestId('dock-drag-handle').focus();
      await expect(shell).toHaveAttribute('data-expanded', 'true');
      await expect(shell).toHaveAttribute('data-reveal', '1');
      await assistant.focus();
      await expect(assistant).toBeFocused();
      await expect.poll(() => assistant.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
      await assistant.press('Enter');
      await expect(component).toHaveAttribute('data-preview-action', 'assistant');
      evidence.push({
        mode,
        theme,
        keyboard: 'Assistant row Enter, visible keyboard focus',
        targets: props.workspaces
          .slice(0, 2)
          .map((item) => String(item.workspace.id))
          .concat('__chief__'),
      });
    }
    await component.unmount();
  }
  const source = await Promise.all(
    ['AdaptiveDockShell.svelte', 'DockOverview.svelte'].map(async (name) => ({
      name,
      sha256: createHash('sha256')
        .update(await readFile(`src/features/hud/components/${name}`))
        .digest('hex'),
    })),
  );
  const json = testInfo.outputPath('mode-visuals.json');
  await writeFile(
    json,
    JSON.stringify(
      {
        stage: process.env.DOCK_MODE_STAGE ?? 'before',
        source,
        evidence,
        scope: 'browser preview only; fake callbacks; no native capture/microphone/delivery',
      },
      null,
      2,
    ),
  );
  await testInfo.attach('Mode geometry', { path: json, contentType: 'application/json' });
});

test('floating companion opens on hover and keyboard without a close button', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 680 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  await page.mouse.move(700, 660);
  const props = dockRailPreview.states.floating.props;
  const component = await mount(DockRailPreview, {
    props: { ...props, workspaces: props.workspaces.slice(0, 2) },
  });
  const shell = component.getByTestId('dock-shell');
  const grip = component.getByTestId('dock-drag-handle');
  // The Assistant row (pinned below the list) stands in for any focusable row control.
  const pen = component.locator('[data-dock-row][data-workspace-id="dock:assistant"]');
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await expect(component.getByTestId('dock-dismiss')).toHaveCount(0);
  const compact = testInfo.outputPath('floating-compact.png');
  await component.screenshot({ path: compact });
  await testInfo.attach('Floating compact', { path: compact, contentType: 'image/png' });

  await grip.hover();
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await expect(component.locator('[data-dock-row]')).toHaveCount(3);
  await expect(component.getByTestId('dock-row-feedback')).toHaveCount(0);
  await expect(component.getByTestId('dock-dismiss')).toHaveCount(0);
  const expanded = testInfo.outputPath('floating-hover.png');
  await component.screenshot({ path: expanded });
  await testInfo.attach('Floating hover', { path: expanded, contentType: 'image/png' });
  await component.locator('.overview-row.assistant-row').hover();
  await expect(pen).toHaveCSS('pointer-events', 'auto');
  await pen.click();
  await expect(component).toHaveAttribute('data-preview-action', 'assistant');
  await expect(pen).toBeFocused();
  await page.mouse.move(700, 660);
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await expect(component.locator('.overview-frame')).toHaveAttribute('inert', '');
  await pen.focus();
  await expect(pen).not.toBeFocused();

  await shell.evaluate((el) => {
    const state = {
      frames: [] as { time: number; reveal: number; height: number }[],
      running: true,
    };
    Object.assign(window, { __floatingMotion: state });
    const sample = (time: number) => {
      const path = el.querySelector<SVGPathElement>('.shell-silhouette path');
      state.frames.push({
        time,
        reveal: Number(el.getAttribute('data-reveal')),
        height: path?.getBoundingClientRect().height ?? 0,
      });
      if (state.running) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await grip.hover();
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await page.mouse.move(700, 660);
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await grip.hover();
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await page.mouse.move(700, 660);
  await expect(shell).toHaveAttribute('data-reveal', '0');
  const motion = await page.evaluate(() => {
    const state = (
      window as unknown as {
        __floatingMotion: {
          running: boolean;
          frames: { time: number; reveal: number; height: number }[];
        };
      }
    ).__floatingMotion;
    state.running = false;
    return state.frames;
  });
  expect(motion.every((f) => f.reveal >= 0 && f.reveal <= 1)).toBe(true);
  await page.evaluate(() => {
    const events: unknown[] = [];
    Object.assign(window, { __floatingFocus: events });
    for (const type of ['focusin', 'focusout'])
      document.addEventListener(type, (event) => {
        const el = event.target as HTMLElement;
        const related = (event as FocusEvent).relatedTarget;
        events.push({
          type,
          name: el.getAttribute('aria-label'),
          testId: el.getAttribute('data-testid'),
          row: el.getAttribute('data-dock-row'),
          tag: el.tagName,
          related:
            related instanceof HTMLElement
              ? {
                  tag: related.tagName,
                  testId: related.getAttribute('data-testid'),
                  className: related.className,
                  insideSurface: Boolean(related.closest('[data-testid="dock-surface"]')),
                }
              : null,
        });
      });
  });

  await page.keyboard.press('Tab');
  await expect(grip).toBeFocused();
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await expect(component.locator('.overview-frame')).not.toHaveAttribute('inert', '');
  await expect(pen).toBeVisible();
  await grip.press('Tab');
  await writeFile(
    testInfo.outputPath('floating-keyboard-diagnostic.json'),
    JSON.stringify(
      await page.evaluate(() => ({
        events: (window as unknown as { __floatingFocus: unknown[] }).__floatingFocus,
        focused: document.activeElement?.outerHTML,
        overview: document.querySelector('.overview-frame')?.getAttribute('inert'),
        reveal: document.querySelector('[data-testid="dock-shell"]')?.getAttribute('data-reveal'),
      })),
      null,
      2,
    ),
  );
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
  await writeFile(
    testInfo.outputPath('floating-hover-evidence.json'),
    JSON.stringify(
      {
        motion,
        actions: await component.getAttribute('data-preview-actions'),
        pointer: await component.getAttribute('data-preview-pointer'),
        scope:
          'real browser renderer with fake preview callbacks; no native fixture or physical input',
      },
      null,
      2,
    ),
  );
  await component.unmount();
});

test('companion visual audit of sparse long and transient states', async ({
  mount,
  page,
}, testInfo) => {
  test.skip(process.env.COMPANION_AUDIT !== '1', 'Opt-in visual audit');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 900, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const observations: unknown[] = [];
  for (const theme of ['dark', 'light'] as const) {
    for (const mode of ['notch', 'top-pill', 'floating', 'side-left', 'side-right'] as const) {
      for (const content of ['empty', 'long'] as const) {
        await page.mouse.move(850, 690);
        const props = dockRailPreview.states[mode].props;
        const workspaces =
          content === 'empty'
            ? []
            : dockRailPreview.states['floating-overflow'].props.workspaces
                .slice(0, 12)
                .map((item) => ({
                  ...item,
                  workspace: {
                    ...item.workspace,
                    title: `${item.workspace.title} — investigate asynchronous workspace synchronization and accessibility`,
                    statusMessage:
                      'A long status report that should remain readable while preserving every feedback action and timestamp.',
                  },
                }));
        const component = await mount(DockRailPreview, { props: { ...props, workspaces, theme } });
        const shell = component.getByTestId('dock-shell');
        await expect(shell).toBeVisible();
        if (mode.startsWith('side')) {
          const entries = component.locator('[data-dock-entry]');
          await entries.nth(content === 'empty' ? 0 : 1).hover();
          await expect(component.getByTestId('dock-preview')).toBeVisible();
        } else {
          await component.getByTestId('dock-drag-handle').hover();
          await expect(shell).toHaveAttribute('data-reveal', '1');
        }
        const name = `${theme}-${mode}-${content}`;
        await component.screenshot({ path: testInfo.outputPath(`${name}.png`) });
        observations.push({
          name,
          details: await component.evaluate((host) => ({
            bounds: host.getBoundingClientRect().toJSON(),
            controls: [...host.querySelectorAll<HTMLElement>('button')]
              .filter((el) => !el.closest('[inert]'))
              .map((el) => ({
                label: el.getAttribute('aria-label') ?? el.textContent,
                box: el.getBoundingClientRect().toJSON(),
                scroll: el.scrollWidth,
                client: el.clientWidth,
              })),
            pointer: host.getAttribute('data-preview-pointer'),
          })),
        });
        await component.unmount();
      }
    }
  }
  await writeFile(
    testInfo.outputPath('audit-observations.json'),
    JSON.stringify(observations, null, 2),
  );
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
      await component.locator('[data-dock-entry]').nth(1).hover();
      await expect(component.getByTestId('dock-preview')).toBeVisible();
      await component.locator('[data-dock-entry]').nth(1).click();
    } else {
      await component.getByTestId('dock-drag-handle').hover();
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
    if (mode.startsWith('side-')) {
      await page.mouse.move(850, 690);
      await expect
        .soft(
          component.getByTestId('dock-preview'),
          'Pointer-only pen focus must not pin the card after leaving',
        )
        .toHaveCount(0);
      await component.screenshot({ path: testInfo.outputPath(`${mode}-pointer-leave.png`) });
      evidence.push({
        mode,
        pointerLeave: await component.getByTestId('dock-preview').count(),
        focused: await page.evaluate(() => ({
          tag: document.activeElement?.tagName,
          testId: document.activeElement?.getAttribute('data-testid'),
          focusVisible: document.activeElement?.matches(':focus-visible'),
        })),
      });
    }
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
    await placement.getByTestId('dock-drag-handle').hover();
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

test('floating boundary expansion preserves anchoring and reachable rows', async ({
  mount,
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1000, height: 800 });
  const evidence: unknown[] = [];
  for (const scene of [
    {
      name: 'down-dark',
      height: 720,
      x: 0.5,
      y: 0.12,
      direction: 'down',
      theme: 'dark',
      reduced: false,
    },
    {
      name: 'up-light-negative',
      height: 720,
      x: 0.5,
      y: 0.88,
      direction: 'up',
      theme: 'light',
      reduced: false,
    },
    {
      name: 'short-up-dark',
      height: 360,
      x: 0.5,
      y: 0.55,
      direction: 'up',
      theme: 'dark',
      reduced: true,
    },
    {
      name: 'right-down-light',
      height: 720,
      x: 1,
      y: 0.12,
      direction: 'down',
      theme: 'light',
      reduced: false,
    },
    {
      name: 'right-up-dark',
      height: 720,
      x: 1,
      y: 0.88,
      direction: 'up',
      theme: 'dark',
      reduced: false,
    },
  ] as const) {
    await page.mouse.move(980, 780);
    await page.emulateMedia({ reducedMotion: scene.reduced ? 'reduce' : 'no-preference' });
    const display: DockDisplayGeometry = {
      id: 1,
      bounds: { x: -1200, y: -100, width: 960, height: scene.height },
      workArea: { x: -1200, y: -76, width: 960, height: scene.height - 48 },
      cutout: null,
    };
    const placement = { kind: 'floating', displayId: 1, x: scene.x, y: scene.y } as const;
    const geometry = resolveFloatingDockGeometry(placement, display, DOCK_FLOATING_COMPACT_SIZE);
    const windowBounds = dockWindowEnvelope(
      geometry.surface,
      display,
      null,
      null,
      true,
      DOCK_FLOATING_SHADOW_MARGIN,
    );
    const snapshot: DockPlacementSnapshot = {
      ...adaptiveDockFixture('floating'),
      placement,
      windowBounds,
      surface: dockLocalRect(geometry.surface, windowBounds),
      floatingAnchor: dockLocalRect(geometry.anchor, windowBounds),
      expansionDirection: geometry.expansionDirection,
    };
    const props = dockRailPreview.states['floating-overflow'].props;
    const component = await mount(DockRailPreview, {
      props: {
        ...props,
        theme: scene.theme,
        placement: snapshot,
        floatingDisplay: display,
        viewportHeight: scene.height,
        viewportWidth: 960,
      },
    });
    const host = component.locator('.dock-preview-host');
    const shell = component.getByTestId('dock-shell');
    const grip = component.getByTestId('dock-drag-handle');
    const surface = component.getByTestId('dock-surface');
    await expect(shell).toHaveAttribute('data-reveal', '0');
    const initial = await grip.boundingBox();
    if (!initial) throw new Error('Floating grip missing');
    let expandedGrip: typeof initial | null = null;
    const stableGrip = async () => {
      const current = await grip.boundingBox();
      if (!current) throw new Error('Floating grip missing');
      const expanded = (await shell.getAttribute('data-reveal')) === '1';
      if (expanded && !expandedGrip) expandedGrip = current;
      const expected = expanded ? expandedGrip : initial;
      if (!expected) throw new Error('Grip endpoint missing');
      expect(Math.abs(current.x - expected.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(current.y - expected.y)).toBeLessThanOrEqual(1);
      return current;
    };
    await host.screenshot({ path: testInfo.outputPath(`${scene.name}-compact-envelope.png`) });
    await grip.hover();
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await expect(surface).toHaveAttribute('data-expansion-direction', scene.direction);
    await stableGrip();
    const finalSnapshot = JSON.parse(
      (await component.getAttribute('data-preview-placement')) ?? 'null',
    ) as DockPlacementSnapshot;
    const frame = await component.locator('.overview-frame').boundingBox();
    const gripBox = await grip.boundingBox();
    if (!frame || !gripBox) throw new Error('Expanded content missing');
    const core = await surface.boundingBox();
    const rows = await component.locator('.overview-rows').boundingBox();
    if (!core || !rows) throw new Error('Expanded row viewport missing');
    const header = await component.locator('.companion-header').boundingBox();
    if (!header || !finalSnapshot.floatingAnchor) throw new Error('Floating header/anchor missing');
    expect(finalSnapshot.floatingAnchor.x + finalSnapshot.windowBounds.x).toBeCloseTo(
      geometry.anchor.x,
      0,
    );
    expect(finalSnapshot.floatingAnchor.y + finalSnapshot.windowBounds.y).toBeCloseTo(
      geometry.anchor.y,
      0,
    );
    const gutters = {
      left: rows.x - core.x,
      right: core.x + core.width - rows.x - rows.width,
    };
    if (scene.direction === 'up') expect(frame.y + frame.height).toBeLessThanOrEqual(gripBox.y + 1);
    else expect(frame.y).toBeGreaterThanOrEqual(gripBox.y + gripBox.height - 1);
    // The last workspace in the scrolled list (Assistant is pinned below it).
    const lastRow = component.locator('.overview-rows [data-dock-row]').last();
    await lastRow.scrollIntoViewIfNeeded();
    await component.locator('.overview-rows .overview-row').last().hover();
    await expect(lastRow).toHaveCSS('pointer-events', 'auto');
    const rowBox = await lastRow.boundingBox();
    if (!rowBox) throw new Error('Last row missing');
    expect(rowBox.y).toBeGreaterThanOrEqual(frame.y);
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
    const id = await lastRow.getAttribute('data-workspace-id');
    await lastRow.click();
    await expect(component).toHaveAttribute('data-preview-action', `workspace:${id}`);
    const scroll = await component
      .locator('.overview-rows')
      .evaluate((el) => ({ height: el.clientHeight, content: el.scrollHeight, top: el.scrollTop }));
    if (scene.reduced) {
      expect(scroll.content).toBeGreaterThan(scroll.height);
      expect(scroll.top).toBeGreaterThan(0);
    }
    await expect
      .poll(async () => {
        const pointer = JSON.parse((await component.getAttribute('data-preview-pointer')) ?? '{}');
        return pointer.regions?.some(
          (r: { x: number; y: number; width: number; height: number }) =>
            Math.abs(r.x - finalSnapshot.surface.x) < 1 &&
            Math.abs(r.y - finalSnapshot.surface.y) < 1 &&
            Math.abs(r.height - finalSnapshot.surface.height) < 1,
        );
      })
      .toBe(true);
    const pointer = JSON.parse((await component.getAttribute('data-preview-pointer')) ?? '{}');
    expect(
      pointer.regions.some(
        (r: { x: number; y: number; width: number; height: number }) =>
          r.x <= 1 && r.y <= 1 && r.x + r.width >= 1 && r.y + r.height >= 1,
      ),
    ).toBe(false);
    await host.screenshot({ path: testInfo.outputPath(`${scene.name}-expanded-envelope.png`) });
    await page.mouse.move(980, 780);
    await expect(shell).toHaveAttribute('data-reveal', '0');
    await stableGrip();
    await expect(component.locator('.overview-frame')).toHaveAttribute('inert', '');
    await grip.hover();
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await page.mouse.move(980, 780);
    await expect(shell).toHaveAttribute('data-expanded', 'false');
    await grip.hover();
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await stableGrip();
    await page.mouse.move(980, 780);
    await expect(shell).toHaveAttribute('data-reveal', '0');
    await page.keyboard.press('Tab');
    await grip.focus();
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await grip.press('Tab');
    await expect(component.locator('.overview-frame')).not.toHaveAttribute('inert', '');
    expect(
      await component
        .locator('.overview-frame')
        .evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    evidence.push({
      scene,
      display,
      initial,
      finalSnapshot,
      gutters,
      header,
      expandedGrip,
      scroll,
      pointer,
      grip: await stableGrip(),
    });
    await component.unmount();
  }
  await writeFile(
    testInfo.outputPath('floating-boundaries.json'),
    JSON.stringify(
      {
        scope:
          'Browser renderer with production geometry; synthetic input, no physical desktop or native window proof',
        evidence,
      },
      null,
      2,
    ),
  );
});

test('floating compact and expanded headers preserve the screen-relative drag origin', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(980, 780);
  const display: DockDisplayGeometry = {
    id: 1,
    bounds: { x: -1200, y: -100, width: 960, height: 720 },
    workArea: { x: -1200, y: -76, width: 960, height: 672 },
    cutout: null,
  };
  const placement = { kind: 'floating', displayId: 1, x: 0.5, y: 0.88 } as const;
  const geometry = resolveFloatingDockGeometry(placement, display, DOCK_FLOATING_COMPACT_SIZE);
  const windowBounds = dockWindowEnvelope(
    geometry.surface,
    display,
    null,
    null,
    true,
    DOCK_FLOATING_SHADOW_MARGIN,
  );
  const snapshot: DockPlacementSnapshot = {
    ...adaptiveDockFixture('floating'),
    placement,
    windowBounds,
    surface: dockLocalRect(geometry.surface, windowBounds),
    floatingAnchor: dockLocalRect(geometry.anchor, windowBounds),
    expansionDirection: geometry.expansionDirection,
  };
  const props = dockRailPreview.states.floating.props;
  for (const expanded of [false, true]) {
    await page.mouse.move(980, 780);
    const component = await mount(DockRailPreview, {
      props: {
        ...props,
        placement: snapshot,
        controlledPlacement: true,
        floatingDisplay: display,
        viewportWidth: 960,
        viewportHeight: 720,
      },
    });
    const grip = component.getByTestId('dock-drag-handle');
    const shell = component.getByTestId('dock-shell');
    // User contract: the idle floating pill and authoritative drag pill share a width.
    expect(geometry.anchor.width).toBe(224);
    await expect(component.locator('.companion-header')).toHaveCSS('cursor', 'grab');
    await expect(grip.locator('svg').first()).toHaveCSS('cursor', 'grab');
    await grip.hover();
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await expect(component.getByTestId('dock-surface')).toHaveAttribute(
      'data-expansion-direction',
      'up',
    );
    if (!expanded) {
      await page.mouse.move(980, 780);
      await expect(shell).toHaveAttribute('data-reveal', '0');
    }
    if (expanded) await page.emulateMedia({ reducedMotion: 'no-preference' });
    const current = JSON.parse(
      (await component.getAttribute('data-preview-placement')) ?? 'null',
    ) as DockPlacementSnapshot;
    const press = await grip.evaluate(
      async (el, { current, expanded }) => {
        const host = el.closest('.dock-preview-host');
        const header = el.closest('.companion-header');
        if (!host || !header) throw new Error('Native-window header preview missing');
        const box = el.getBoundingClientRect();
        const windowBox = host.getBoundingClientRect();
        const headerBox = header.getBoundingClientRect();
        const screenX = box.x + box.width / 2 - windowBox.x + current.windowBounds.x;
        const screenY = box.y + box.height / 2 - windowBox.y + current.windowBounds.y;
        const headerBounds = {
          x: headerBox.x - windowBox.x,
          y: headerBox.y - windowBox.y,
          width: headerBox.width,
          height: headerBox.height,
        };
        // Controlled coordinate boundary only: a browser preview cannot own a native OS pointer.
        el.setPointerCapture = () => {};
        el.releasePointerCapture = () => {};
        const init = {
          bubbles: true,
          pointerId: 91,
          isPrimary: true,
          button: 0,
          buttons: 1,
          screenX,
          screenY,
        };
        el.dispatchEvent(new PointerEvent('pointerdown', init));
        el.dispatchEvent(new PointerEvent('pointermove', { ...init, screenX: screenX + 20 }));
        let firstDragFrame = null;
        if (expanded) {
          const dragging: DockPlacementSnapshot = {
            ...current,
            revision: current.revision + 1,
            phase: 'dragging',
            dragToken: 'expanded-origin',
            surface: { x: headerBounds.x, y: headerBounds.y, width: 224, height: 40 },
            floatingAnchor: undefined,
            snapPreview: null,
            dragTarget: null,
          };
          // Deliver native geometry before a closing overview gets another frame.
          window.dispatchEvent(
            new CustomEvent('dock-preview-placement', { detail: { placement: dragging } }),
          );
          await new Promise(requestAnimationFrame);
          const path = host.querySelector<SVGPathElement>('.shell-silhouette > path');
          if (!path) throw new Error('Missing compact drag body');
          const native = JSON.parse(host.getAttribute('data-preview-placement') ?? 'null');
          const { x, y, width, height } = path.getBBox();
          firstDragFrame = { body: { x, y, width, height }, core: native.surface };
        }
        return {
          screenX,
          screenY,
          headerBounds,
          firstDragFrame,
        };
      },
      { current, expanded },
    );
    await expect
      .poll(
        async () =>
          JSON.parse((await component.getAttribute('data-preview-commands')) ?? '[]').filter(
            (c: { action: string }) => c.action === 'begin-drag',
          ).length,
      )
      .toBe(1);
    const commands = JSON.parse((await component.getAttribute('data-preview-commands')) ?? '[]');
    const begin = commands.find((c: { action: string }) => c.action === 'begin-drag');
    expect(begin.revision).toBe(current.revision);
    expect(begin.origin.x).toBeCloseTo(
      press.screenX - current.windowBounds.x - current.surface.x,
      5,
    );
    expect(begin.origin.y).toBeCloseTo(
      press.screenY - current.windowBounds.y - current.surface.y,
      5,
    );
    expect(begin.origin.y).toBeGreaterThan(DOCK_FLOATING_COMPACT_SIZE.height);
    expect(begin.origin.y).toBeLessThan(current.surface.height);
    expect(begin.headerBounds).toBeDefined();
    for (const dimension of ['x', 'y', 'width', 'height'] as const)
      expect(begin.headerBounds[dimension]).toBeCloseTo(press.headerBounds[dimension], 0);
    if (expanded) {
      if (!current.floatingAnchor) throw new Error('Compact anchor missing');
      expect(press.screenX).toBeLessThan(current.windowBounds.x + current.floatingAnchor.x);
      expect(begin.origin.x).toBeGreaterThanOrEqual(0);

      // The overview has already hidden its content when native drag begins.
      // Its abandoned card must not remain as an empty surface over the desktop.
      const firstDragFrame = press.firstDragFrame;
      if (!firstDragFrame) throw new Error('Missing first expanded drag frame');
      expect(firstDragFrame.body.width).toBeLessThanOrEqual(firstDragFrame.core.width + 1);
      expect(firstDragFrame.body.height).toBeLessThanOrEqual(firstDragFrame.core.height + 1);
      await writeFile(
        testInfo.outputPath('expanded-origin-first-drag-frame.json'),
        JSON.stringify(firstDragFrame, null, 2),
      );
      await component.screenshot({
        path: testInfo.outputPath('expanded-origin-drag.png'),
        style: '.dock-preview-host { background: transparent !important; }',
      });
    }
    await writeFile(
      testInfo.outputPath(`floating-${expanded ? 'expanded' : 'compact'}-drag-origin.json`),
      JSON.stringify(
        {
          scope:
            'Synthetic pointer events through real renderer; capture stubbed, no native drag/movement claim',
          current,
          press,
          begin,
        },
        null,
        2,
      ),
    );
    await component.unmount();
  }
});

for (const { origin, finish } of [
  ...(
    [
      'accepted-release',
      'pending-release',
      'escape',
      'capture-loss',
      'rejected',
      'cancel-after-release',
    ] as const
  ).map((finish) => ({ origin: 'right-edge' as const, finish })),
  { origin: 'compact-notch' as const, finish: 'pending-release' as const },
]) {
  test(`${origin} drag preserves terminal intent: ${finish}`, async ({ mount, page }, testInfo) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const display: DockDisplayGeometry = {
      id: 1,
      bounds: { x: -1200, y: -100, width: 1000, height: 700 },
      workArea: { x: -1200, y: -76, width: 1000, height: 676 },
      cutout: origin === 'compact-notch' ? { x: -776, y: -100, width: 152, height: 32 } : null,
    };
    const target: DockPlacementSnapshot['placement'] =
      origin === 'compact-notch'
        ? { kind: 'notch', displayId: 1 }
        : { kind: 'edge', displayId: 1, side: 'right', along: 0.5 };
    const surface = resolveDockSurface(
      target,
      display,
      origin === 'compact-notch' ? { width: 224, height: 32 } : { width: 40, height: 144 },
    );
    const windowBounds = dockWindowEnvelope(
      surface,
      display,
      null,
      target.kind === 'edge' ? target.side : null,
      true,
    );
    const initial: DockPlacementSnapshot = {
      ...adaptiveDockFixture(origin === 'compact-notch' ? 'notch' : 'edge', 'right'),
      revision: 100,
      placement: target,
      windowBounds,
      surface: dockLocalRect(surface, windowBounds),
      cutout: display.cutout ? dockLocalRect(display.cutout, windowBounds) : null,
      workArea: dockLocalRect(display.workArea, windowBounds),
    };
    const component = await mount(DockRailPreview, {
      props: {
        ...dockRailPreview.states['side-right'].props,
        placement: initial,
        floatingDisplay: display,
        controlledPlacement: true,
      },
    });
    const grip = component.getByTestId('dock-drag-handle');
    const commands = async () =>
      JSON.parse((await component.getAttribute('data-preview-commands')) ?? '[]');
    const box = await grip.boundingBox();
    if (!box) throw new Error('Origin grip missing');
    const press = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(press.x - 12, press.y);
    await expect
      .poll(
        async () =>
          (await commands()).filter((c: { action: string }) => c.action === 'begin-drag').length,
      )
      .toBe(1);
    if (finish === 'accepted-release' || finish === 'pending-release') {
      // A native focus transfer may arrive while begin is still awaiting its ack.
      await grip.evaluate((el) => {
        el.blur();
        el.focus();
      });
      await expect(grip).toBeFocused();
    }
    const begin = (await commands()).find((c: { action: string }) => c.action === 'begin-drag');
    const release = { x: 500, y: 350 };
    const releasePoint = { x: display.bounds.x + release.x, y: display.bounds.y + release.y };
    const dragSurface = {
      x: releasePoint.x - begin.origin.x,
      y: releasePoint.y - Math.min(36, begin.origin.y),
      width: 224,
      height: 40,
    };
    const dragWindow = dockWindowEnvelope(
      dragSurface,
      display,
      null,
      null,
      true,
      DOCK_FLOATING_SHADOW_MARGIN,
    );
    const dragging: DockPlacementSnapshot = {
      ...initial,
      revision: 101,
      shape: 'floating',
      cutout: null,
      phase: 'dragging',
      dragToken: 'held-start',
      windowBounds: dragWindow,
      surface: dockLocalRect(dragSurface, dragWindow),
      workArea: dockLocalRect(display.workArea, dragWindow),
    };
    const acknowledge = () =>
      page.evaluate(
        (placement) =>
          window.dispatchEvent(
            new CustomEvent('dock-preview-placement', {
              detail: { placement, dragStartResult: { id: 1, token: 'held-start' } },
            }),
          ),
        dragging,
      );
    if (finish === 'accepted-release') {
      await acknowledge();
      await grip.evaluate((el) => {
        el.blur();
        el.focus();
      });
      await expect(grip).toBeFocused();
    }
    await page.mouse.move(release.x, release.y, { steps: 16 });
    if (finish === 'escape') await page.keyboard.press('Escape');
    if (finish === 'capture-loss')
      await grip.evaluate((el) => {
        if (!el.hasPointerCapture(1)) throw new Error('Expected real Chromium pointer capture');
        el.releasePointerCapture(1);
      });
    await page.mouse.up();
    // A later cursor move must not replace the release point while begin is held.
    await page.mouse.move(970, 600);
    if (finish === 'cancel-after-release') await page.keyboard.press('Escape');
    if (finish === 'rejected') {
      await page.evaluate(
        (placement) =>
          window.dispatchEvent(
            new CustomEvent('dock-preview-placement', {
              detail: { placement, dragStartResult: { id: 1, token: null } },
            }),
          ),
        { ...initial, revision: 102 },
      );
      await expect(grip).toHaveCSS('cursor', 'grab');
    } else if (finish !== 'accepted-release') await acknowledge();
    const terminal = () =>
      commands().then((all) =>
        all.filter(
          (c: { action: string }) => c.action === 'end-drag' || c.action === 'cancel-drag',
        ),
      );
    await expect.poll(async () => (await terminal()).length).toBe(finish === 'rejected' ? 0 : 1);
    const result = (await terminal())[0];
    const cancelled =
      finish === 'escape' || finish === 'capture-loss' || finish === 'cancel-after-release';
    if (finish !== 'rejected') {
      expect(result.action).toBe(cancelled ? 'cancel-drag' : 'end-drag');
      expect(result.token).toBe('held-start');
      if (!cancelled) expect(result.releasePoint).toEqual(releasePoint);
    }
    let trajectory: unknown[] = [];
    if (finish === 'accepted-release' || finish === 'pending-release') {
      // Real renderer frame trace in the synthetic display. The DOM host and
      // snapshot update together here; native-before-paint ordering is covered
      // by the separately owned Electron fixture, not claimed by this trace.
      await component.evaluate((root, origin) => {
        const trace: unknown[] = [];
        const record = () => {
          if (!root.isConnected || trace.length >= 30) return;
          const displayRect = root.getBoundingClientRect();
          const screenRect = (el: Element | null) => {
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return {
              x: b.x - displayRect.x + origin.x,
              y: b.y - displayRect.y + origin.y,
              width: b.width,
              height: b.height,
            };
          };
          trace.push({
            time: performance.now(),
            placement: JSON.parse(root.getAttribute('data-preview-placement') ?? '{}'),
            pointer: JSON.parse(root.getAttribute('data-preview-pointer') ?? '{}'),
            core: screenRect(root.querySelector('[data-testid="dock-surface"]')),
            grip: screenRect(root.querySelector('[data-testid="dock-drag-handle"]')),
          });
          requestAnimationFrame(record);
        };
        (root as HTMLElement & { releaseTrajectory?: unknown[] }).releaseTrajectory = trace;
        record();
      }, display.bounds);
      const floatingTarget = floatingDockPlacement(dragSurface, display);
      const geometry = resolveFloatingDockGeometry(
        floatingTarget,
        display,
        DOCK_FLOATING_COMPACT_SIZE,
      );
      const idleWindow = dockWindowEnvelope(
        geometry.surface,
        display,
        null,
        null,
        true,
        DOCK_FLOATING_SHADOW_MARGIN,
      );
      const idle: DockPlacementSnapshot = {
        ...dragging,
        revision: 102,
        phase: 'idle',
        dragToken: null,
        placement: floatingTarget,
        windowBounds: idleWindow,
        surface: dockLocalRect(geometry.surface, idleWindow),
        floatingAnchor: dockLocalRect(geometry.anchor, idleWindow),
        expansionDirection: geometry.expansionDirection,
        workArea: dockLocalRect(display.workArea, idleWindow),
      };
      await page.evaluate(
        (placement) =>
          window.dispatchEvent(
            new CustomEvent('dock-preview-placement', { detail: { placement } }),
          ),
        idle,
      );
      await expect
        .poll(async () =>
          (await commands()).some(
            (c: { action: string; revision?: number }) =>
              c.action === 'resize' && c.revision === idle.revision,
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          component.evaluate(
            (root) =>
              (root as HTMLElement & { releaseTrajectory?: unknown[] }).releaseTrajectory?.length ??
              0,
          ),
        )
        .toBe(30);
      trajectory = await component.evaluate(
        (root) => (root as HTMLElement & { releaseTrajectory?: unknown[] }).releaseTrajectory ?? [],
      );
      await writeFile(
        testInfo.outputPath(`${origin}-${finish}-release-frames.json`),
        JSON.stringify(trajectory, null, 2),
      );
      const samples = trajectory as {
        placement: DockPlacementSnapshot;
        core: { x: number; y: number; width: number; height: number };
        grip: { x: number; y: number; width: number; height: number };
        pointer: { regions: { x: number; y: number; width: number; height: number }[] };
      }[];
      for (const sample of samples) {
        expect(Math.abs(sample.core.x - dragSurface.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(sample.core.y - dragSurface.y)).toBeLessThanOrEqual(1);
        expect(sample.pointer.regions).toEqual([sample.placement.surface]);
      }
      await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '0');
      const final = samples.at(-1)!;
      // Native commit must complete while preserving the final input region.
      expect(samples.some((sample) => sample.placement.phase === 'idle')).toBe(true);
      expect(final.pointer.regions).toContainEqual(final.placement.surface);
      expect(final.pointer.regions).toHaveLength(1);
      await component.screenshot({ path: testInfo.outputPath(`${origin}-${finish}-settled.png`) });
      // Native focus must not rearm disclosure, while a new intentional hover
      // and keyboard interaction must remain usable after the gesture.
      await grip.hover();
      await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
      await page.mouse.move(970, 600);
      await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '0');
      await grip.focus();
      await grip.press('Enter');
      await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
    }
    await writeFile(
      testInfo.outputPath(`${origin}-${finish}.json`),
      JSON.stringify(
        {
          scope:
            'Actual renderer and Chromium pointer capture, synthetic native snapshots/ack; native commit geometry verified separately',
          begin,
          releasePoint,
          laterCursor: { x: display.bounds.x + 970, y: display.bounds.y + 600 },
          result,
          trajectory,
          commands: await commands(),
        },
        null,
        2,
      ),
    );
    await component.unmount();
  });
}

for (const reduced of [false, true]) {
  test(`rigid drag preserves grip and input geometry: ${reduced ? 'reduced' : 'normal'} motion`, async ({
    mount,
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    // Model the transparent Electron window over a contrasting synthetic desktop;
    // an opaque bg-background host otherwise hides the detached filled contour.
    await page.addStyleTag({
      content:
        '.dock-preview-host { background: transparent !important; } div[data-preview-placement] { background: hsl(var(--muted)); }',
    });
    await page.mouse.move(1200, 760);
    const display: DockDisplayGeometry = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1000, height: 700 },
      workArea: { x: 0, y: 0, width: 1000, height: 700 },
      cutout: { x: 424, y: 0, width: 152, height: 32 },
    };
    type Rect = DockPlacementSnapshot['surface'];
    let revision = 100;
    let originPlacement: DockPlacementSnapshot['placement'] = {
      kind: 'floating',
      displayId: 1,
      x: 0.35,
      y: 0.4,
    };
    const geometry = resolveFloatingDockGeometry(
      originPlacement,
      display,
      DOCK_FLOATING_COMPACT_SIZE,
    );
    const initialBounds = dockWindowEnvelope(geometry.surface, display, null, null, true, 64);
    const initial: DockPlacementSnapshot = {
      ...adaptiveDockFixture('floating'),
      revision: ++revision,
      placement: originPlacement,
      windowBounds: initialBounds,
      surface: dockLocalRect(geometry.surface, initialBounds),
      floatingAnchor: dockLocalRect(geometry.anchor, initialBounds),
      expansionDirection: geometry.expansionDirection,
    };
    const union = (a: Rect, b: Rect): Rect => {
      const x = Math.min(a.x, b.x),
        y = Math.min(a.y, b.y);
      return {
        x,
        y,
        width: Math.max(a.x + a.width, b.x + b.width) - x,
        height: Math.max(a.y + a.height, b.y + b.height) - y,
      };
    };
    const moving = (
      x: number,
      y: number,
      token: string,
      candidate: 'left' | 'right' | 'notch' | null,
      along = 0.4,
    ): DockPlacementSnapshot => {
      const surface = { x, y, width: 224, height: 40 };
      const placement: DockPlacementSnapshot['placement'] | null =
        candidate === 'notch'
          ? { kind: 'notch', displayId: 1 }
          : candidate
            ? { kind: 'edge', displayId: 1, side: candidate, along }
            : null;
      // External native candidate contract: the two-row rail is 144px high;
      // hardware cutout plus two 36px wings is 224px wide.
      const target = placement
        ? resolveDockSurface(
            placement,
            display,
            placement.kind === 'notch' ? { width: 224, height: 32 } : { width: 40, height: 144 },
          )
        : null;
      let bounds = dockWindowEnvelope(surface, display, null, null, true, 64);
      if (target && placement)
        bounds = union(
          bounds,
          dockWindowEnvelope(
            target,
            display,
            null,
            placement.kind === 'edge' ? placement.side : null,
          ),
        );
      return {
        ...initial,
        revision: ++revision,
        placement: originPlacement,
        shape: 'floating',
        windowBounds: bounds,
        workArea: dockLocalRect(display.workArea, bounds),
        surface: dockLocalRect(surface, bounds),
        floatingAnchor: undefined,
        cutout: null,
        phase: 'dragging',
        dragToken: token,
        snapPreview: target ? dockLocalRect(target, bounds) : null,
        dragTarget:
          target && placement
            ? {
                placement,
                shape: candidate === 'notch' ? 'notch' : 'edge',
                surface: dockLocalRect(target, bounds),
                cutout:
                  candidate === 'notch' && display.cutout
                    ? dockLocalRect(display.cutout, bounds)
                    : null,
              }
            : null,
      };
    };
    const send = async (
      snapshot: DockPlacementSnapshot,
      result?: { id: number; token: string | null },
    ) =>
      page.evaluate(
        ({ snapshot, result }) =>
          window.dispatchEvent(
            new CustomEvent('dock-preview-placement', {
              detail: { placement: snapshot, dragStartResult: result },
            }),
          ),
        { snapshot, result },
      );
    const props = dockRailPreview.states.floating.props;
    const component = await mount(DockRailPreview, {
      props: {
        ...props,
        theme: reduced ? 'light' : 'dark',
        placement: initial,
        floatingDisplay: display,
        controlledPlacement: true,
        manualResizeAcknowledgements: true,
        viewportWidth: 1000,
        viewportHeight: 700,
        workspaces: props.workspaces.slice(0, 2),
      },
    });
    const shell = component.getByTestId('dock-shell');
    const grip = component.getByTestId('dock-drag-handle');
    const begin = async (token: string, id: number) => {
      const before = JSON.parse(
        (await component.getAttribute('data-preview-placement')) ?? 'null',
      ) as DockPlacementSnapshot;
      const press = await grip.evaluate((el, before) => {
        const host = el.closest('.dock-preview-host');
        if (!host) throw new Error('Missing window');
        const box = el.getBoundingClientRect(),
          h = host.getBoundingClientRect();
        const point = {
          screenX: box.x + box.width / 2 - h.x + before.windowBounds.x,
          screenY: box.y + box.height / 2 - h.y + before.windowBounds.y,
        };
        // This phase-snapshot case isolates rendering; the existing terminal-intent
        // cases separately exercise real Chromium pointer capture and delayed IPC.
        el.setPointerCapture = () => {};
        el.releasePointerCapture = () => {};
        el.dispatchEvent(
          new PointerEvent('pointerdown', {
            ...point,
            bubbles: true,
            isPrimary: true,
            pointerId: 91,
            button: 0,
            buttons: 1,
          }),
        );
        return point;
      }, before);
      await expect(grip).toHaveCSS('cursor', 'grabbing');
      await grip.dispatchEvent('pointermove', {
        ...press,
        screenX: press.screenX + 12,
        bubbles: true,
        isPrimary: true,
        pointerId: 91,
        button: 0,
        buttons: 1,
      });
      const command = JSON.parse((await component.getAttribute('data-preview-commands')) ?? '[]')
        .filter((c: { action: string }) => c.action === 'begin-drag')
        .at(-1);
      expect(command.origin.x).toBeCloseTo(
        press.screenX - before.windowBounds.x - before.surface.x,
        4,
      );
      expect(command.origin.y).toBeCloseTo(
        press.screenY - before.windowBounds.y - before.surface.y,
        4,
      );
      await send(
        moving(press.screenX - command.origin.x, press.screenY - command.origin.y, token, null),
        { id, token },
      );
      await expect(shell).toHaveAttribute('data-dragging', 'true');
      return command;
    };
    const token = 'rigid-held';
    const started = await begin(token, 1);
    const samples: unknown[] = [];
    const sampleFrames = async (count: number, label: string, snapshot?: DockPlacementSnapshot) => {
      const result = await component.evaluate(
        async (root, { count, label, snapshot }) => {
          if (snapshot)
            window.dispatchEvent(
              new CustomEvent('dock-preview-placement', { detail: { placement: snapshot } }),
            );
          const frames = [];
          for (let i = 0; i < count; i++) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            const host = root.querySelector<HTMLElement>('.dock-preview-host');
            const grip = root.querySelector<HTMLElement>('[data-testid="dock-drag-handle"]');
            const path = root.querySelector<SVGPathElement>('.shell-silhouette > path');
            if (!host || !grip || !path) throw new Error('Missing painted shell or grip');
            const placement = JSON.parse(root.getAttribute('data-preview-placement') ?? 'null');
            const h = host.getBoundingClientRect(),
              g = grip.getBoundingClientRect(),
              p = path.getBoundingClientRect();
            const style = getComputedStyle(path);
            const section = root.querySelector<HTMLElement>('[data-testid="dock-surface"]');
            const shell = root.querySelector<HTMLElement>('[data-testid="dock-shell"]');
            const styles = (el: Element | null) => {
              if (!el) return null;
              const computed = getComputedStyle(el);
              return {
                inline: el.getAttribute('style'),
                left: computed.left,
                top: computed.top,
                width: computed.width,
                height: computed.height,
                transform: computed.transform,
                transitionProperty: computed.transitionProperty,
                transitionDuration: computed.transitionDuration,
                animations: el.getAnimations().map((animation) => ({
                  state: animation.playState,
                  currentTime: animation.currentTime,
                })),
              };
            };
            const svg = path.ownerSVGElement;
            const viewport = svg?.getBoundingClientRect();
            const logos = Array.from(root.querySelectorAll('.grip-mark'))
              .filter((el) => {
                const style = getComputedStyle(el);
                return (
                  style.visibility === 'visible' &&
                  style.display !== 'none' &&
                  Number(style.opacity) > 0
                );
              })
              .map((el) => {
                const b = el.getBoundingClientRect();
                const matrix = path.getScreenCTM()?.inverse();
                const supported =
                  !!matrix &&
                  [
                    [b.x + b.width / 2, b.y + b.height / 2],
                    [b.left, b.top],
                    [b.right, b.top],
                    [b.left, b.bottom],
                    [b.right, b.bottom],
                  ].every(([x, y]) =>
                    path.isPointInFill(new DOMPoint(x, y).matrixTransform(matrix)),
                  );
                return { x: b.x - h.x, y: b.y - h.y, width: b.width, height: b.height, supported };
              });
            frames.push({
              label,
              logos,
              dom: {
                section: styles(section),
                host: styles(host),
                svg: styles(svg),
                shellRevision: shell?.getAttribute('data-revision'),
                sectionRect: section?.getBoundingClientRect().toJSON(),
                hostRect: h.toJSON(),
              },
              time: performance.now(),
              placement,
              pointer: JSON.parse(root.getAttribute('data-preview-pointer') ?? '{}'),
              grip: { x: g.x - h.x, y: g.y - h.y, width: g.width, height: g.height },
              body: { x: p.x - h.x, y: p.y - h.y, width: p.width, height: p.height },
              path: path.getAttribute('d'),
              fill: style.fill,
              opacity: style.opacity,
              preview:
                root
                  .querySelector('[data-testid="dock-snap-preview"]')
                  ?.getAttribute('data-target') ?? null,
              viewport: viewport
                ? {
                    x: viewport.x - h.x,
                    y: viewport.y - h.y,
                    width: viewport.width,
                    height: viewport.height,
                  }
                : null,
              overflow: svg ? getComputedStyle(svg).overflow : null,
            });
          }
          return frames;
        },
        { count, label, snapshot },
      );
      samples.push(...result);
      return result;
    };
    const initialFrame = (await sampleFrames(2, 'initial-held')).at(-1)!;
    const gripOffset = {
      x: initialFrame.grip.x - initialFrame.placement.surface.x,
      y: initialFrame.grip.y - initialFrame.placement.surface.y,
    };
    const assertHeld = (frames: Awaited<ReturnType<typeof sampleFrames>>) => {
      for (const frame of frames) {
        const core = frame.placement.surface;
        expect(frame.pointer.regions).toEqual([core]);
        expect(frame.pointer.revision).toBe(frame.placement.revision);
        expect(Math.abs(frame.grip.x - core.x - gripOffset.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(frame.grip.y - core.y - gripOffset.y)).toBeLessThanOrEqual(0.5);
        expect(frame.grip.width).toBe(initialFrame.grip.width);
        expect(frame.grip.height).toBe(initialFrame.grip.height);
        expect(frame.preview).toBe(frame.placement.dragTarget?.shape ?? null);
        expect(frame.logos).toHaveLength(1);
        // One ordinary header mark stays inside the rigid, interactive body.
        expect(frame.logos[0].supported, frame.label).toBe(true);
        expect(Number(frame.opacity)).toBeGreaterThan(0);
        expect(frame.viewport).toEqual(core);
        for (const key of ['x', 'y', 'width', 'height'] as const)
          expect(frame.body[key]).toBeCloseTo(core[key], 1);
        expect(frame.placement.windowBounds.x).toBeGreaterThanOrEqual(display.bounds.x);
        expect(frame.placement.windowBounds.y).toBeGreaterThanOrEqual(display.bounds.y);
        expect(
          frame.placement.windowBounds.x + frame.placement.windowBounds.width,
        ).toBeLessThanOrEqual(1000);
        expect(
          frame.placement.windowBounds.y + frame.placement.windowBounds.height,
        ).toBeLessThanOrEqual(700);
      }
    };
    const stages = [
      { name: 'free', x: 350, y: 300, candidate: null },
      { name: 'acquire-left', x: 8, y: 250, candidate: 'left' },
      { name: 'lose-candidate', x: 160, y: 230, candidate: null },
      { name: 'acquire-camera', x: 410, y: 8, candidate: 'notch' },
      { name: 'reverse-right', x: 770, y: 250, candidate: 'right' },
      { name: 'reverse-left', x: 8, y: 250, candidate: 'left' },
      { name: 'bottom-right', x: 770, y: 660, candidate: 'right', along: 1 },
      { name: 'tight-bottom-right', x: 770, y: 660, candidate: 'right', along: 1 },
    ] as const;
    let last = initial;
    try {
      for (const stage of stages) {
        last = moving(
          stage.x,
          stage.y,
          token,
          stage.candidate,
          'along' in stage ? stage.along : 0.4,
        );
        if (stage.name === 'tight-bottom-right') {
          // Platforms without mouse forwarding can allocate only the rail's height.
          const bounds = { ...last.windowBounds, y: 556, height: 144 };
          const dy = last.windowBounds.y - bounds.y;
          const local = (rect: Rect) => ({ ...rect, y: rect.y + dy });
          last = {
            ...last,
            windowBounds: bounds,
            surface: local(last.surface),
            workArea: local(last.workArea),
            snapPreview: last.snapPreview ? local(last.snapPreview) : null,
            dragTarget: last.dragTarget
              ? { ...last.dragTarget, surface: local(last.dragTarget.surface) }
              : null,
          };
        }
        await send(last);
        await expect(shell).toHaveAttribute('data-dragging', 'true');
        const frames = await sampleFrames(reduced ? 2 : 24, stage.name);
        assertHeld(frames);
        if (stage.candidate) {
          await expect(component.getByTestId('dock-snap-preview')).toHaveAttribute(
            'data-target',
            last.dragTarget!.shape,
          );
          expect(last.dragTarget?.surface).toEqual(last.snapPreview);
          for (const region of frames.at(-1)!.pointer.regions) expect(region).toEqual(last.surface);
        } else await expect(component.getByTestId('dock-snap-preview')).toHaveCount(0);
        // Never a light-filled box: the dragged shell and the drop-target preview
        // are drawn dark (perceived luminance) in both themes.
        // One form at a time: with a drop target only its preview is visible (the dragged
        // shell keeps the gesture but fades out); with none, the dragged bar is the fallback.
        await expect
          .poll(() =>
            component.evaluate((root) => {
              const shown = (el: Element | null) => {
                let opacity = 1;
                for (let node = el; node && node !== root; node = node.parentElement)
                  opacity *= Number(getComputedStyle(node).opacity);
                return opacity > 0.01;
              };
              return {
                shell:
                  shown(root.querySelector('.shell-silhouette')) ||
                  shown(root.querySelector('.companion-content')),
                previews: [...root.querySelectorAll('.snap-preview-shape')].filter(shown).length,
              };
            }),
          )
          .toEqual(stage.candidate ? { shell: false, previews: 1 } : { shell: true, previews: 0 });
        await component.screenshot({ path: testInfo.outputPath(`${stage.name}.png`) });
        // Review artifacts: the dragged dock per drop target, in this run's theme.
        const target = { free: 'floating', 'acquire-left': 'edge', 'acquire-camera': 'notch' }[
          stage.name as string
        ];
        if (target) {
          const dir = resolve(process.cwd(), '../../.intent/artifacts');
          await mkdir(dir, { recursive: true });
          await expect
            .poll(() =>
              component.evaluate((root) =>
                [...root.querySelectorAll('.snap-preview-shape')].every(
                  (el) => el.getAnimations().length === 0,
                ),
              ),
            )
            .toBe(true);
          await component.screenshot({
            path: resolve(dir, `dock-drag-preview-${target}-${reduced ? 'light' : 'dark'}.png`),
          });
        }
      }
      await sampleFrames(1, 'last-held');
      const releasePoint = {
        x: last.windowBounds.x + last.surface.x + started.origin.x,
        y: last.windowBounds.y + last.surface.y + started.origin.y,
      };
      await grip.dispatchEvent('pointerup', {
        pointerId: 91,
        isPrimary: true,
        bubbles: true,
        button: 0,
        screenX: releasePoint.x,
        screenY: releasePoint.y,
      });
      await expect
        .poll(
          async () =>
            JSON.parse((await component.getAttribute('data-preview-commands')) ?? '[]').at(-1)
              ?.action,
        )
        .toBe('end-drag');
      const end = JSON.parse((await component.getAttribute('data-preview-commands')) ?? '[]').at(
        -1,
      );
      expect(end.releasePoint).toEqual(releasePoint);
      const candidate = last.dragTarget;
      if (!candidate) throw new Error('Missing committed candidate');
      originPlacement = candidate.placement;
      const committed: DockPlacementSnapshot = {
        ...last,
        revision: ++revision,
        placement: candidate.placement,
        shape: candidate.shape,
        phase: 'idle',
        dragToken: null,
        dragTarget: null,
        snapPreview: null,
        surface: candidate.surface,
        cutout: candidate.cutout,
      };
      // Start RAF sampling in the same browser turn as the native idle delivery,
      // before a Playwright polling interval can skip the first painted frames.
      const releaseFrames = await sampleFrames(
        reduced ? 2 : 30,
        'commit-before-resize-ack',
        committed,
      );
      await expect
        .poll(async () =>
          JSON.parse((await component.getAttribute('data-preview-commands')) ?? '[]').some(
            (command: { action: string; revision?: number }) =>
              command.action === 'resize' && command.revision === committed.revision,
          ),
        )
        .toBe(true);
      releaseFrames.push(
        ...(await sampleFrames(2, 'retained-resize-ack', { ...committed, revision: ++revision })),
      );
      for (const frame of releaseFrames) {
        expect(frame.placement.windowBounds).toEqual(last.windowBounds);
        expect(frame.logos).toHaveLength(1);
        expect(frame.logos[0].supported, frame.label).toBe(true);
        expect(frame.pointer.regions).toContainEqual(candidate.surface);
        expect(Number(frame.opacity)).toBeGreaterThan(0);
      }
      await component.screenshot({ path: testInfo.outputPath('committed.png') });
      await begin('rigid-cancel', 2);
      await send(moving(410, 8, 'rigid-cancel', 'notch'));
      await sampleFrames(reduced ? 2 : 24, 'cancel-held-camera');
      await page.keyboard.press('Escape');
      await expect
        .poll(
          async () =>
            JSON.parse((await component.getAttribute('data-preview-commands')) ?? '[]').at(-1)
              ?.action,
        )
        .toBe('cancel-drag');
      await send({ ...committed, revision: ++revision });
      await expect(component.getByTestId('dock-snap-preview')).toHaveCount(0);
      await expect(shell).toHaveAttribute('data-dragging', 'false');
      // A native drag receipt can outlive its local pointer gesture. Escape
      // must still cancel that token without any animation bookkeeping.
      await send(moving(350, 300, 'native-drag', null));
      await expect(shell).toHaveAttribute('data-dragging', 'true');
      await page.keyboard.press('Escape');
      await expect
        .poll(async () => {
          const commands = JSON.parse(
            (await component.getAttribute('data-preview-commands')) ?? '[]',
          );
          const last = commands.at(-1);
          return { action: last?.action, token: last?.token };
        })
        .toEqual({ action: 'cancel-drag', token: 'native-drag' });
      await send({ ...committed, revision: ++revision });
      await expect(shell).toHaveAttribute('data-dragging', 'false');
    } finally {
      await writeFile(
        testInfo.outputPath('rigid-drag-trajectory.json'),
        JSON.stringify(
          {
            scope:
              'Production renderer, controlled native snapshots/manual resize acknowledgements and synthetic capture. Native allocation ordering and physical OS/compositor continuity are separate proofs.',
            reduced,
            samples,
            commands: JSON.parse((await component.getAttribute('data-preview-commands')) ?? '[]'),
          },
          null,
          2,
        ),
      );
    }
    await component.unmount();
  });
}

for (const shape of ['notch', 'top-pill'] as const) {
  test(`compact ${shape} preserves camera clearance and hover reversal`, async ({
    mount,
    page,
  }, testInfo) => {
    const evidence: unknown[] = [];
    const props = dockRailPreview.states.floating.props;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.mouse.move(1200, 760);
    const component = await mount(DockRailPreview, {
      props: {
        ...dockRailPreview.states.notch.props,
        placement: adaptiveDockFixture(shape),
        workspaces: props.workspaces.slice(0, 2),
        theme: 'dark',
      },
    });
    const shell = component.getByTestId('dock-shell'),
      grip = component.getByTestId('dock-drag-handle');
    await expect(shell).toHaveAttribute('data-reveal', '0');
    await expect(grip).toHaveCSS('cursor', 'grab');
    const compact = await component.locator('.companion-content').evaluate((el) => ({
      clip: getComputedStyle(el).clipPath,
      rect: el.getBoundingClientRect().toJSON(),
    }));
    await component.screenshot({ path: testInfo.outputPath(`${shape}-compact.png`) });
    await grip.hover();
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await expect(component.locator('[data-dock-row]').first()).toHaveCSS('cursor', 'pointer');
    await component.screenshot({ path: testInfo.outputPath(`${shape}-expanded.png`) });
    if (shape === 'notch') {
      const gap = await component.getByTestId('dock-camera-exclusion').boundingBox();
      const logo = await grip.boundingBox();
      if (!gap || !logo) throw new Error('Camera geometry missing');
      expect(logo.x + logo.width).toBeLessThanOrEqual(gap.x);
    }
    await page.mouse.move(1200, 760);
    await expect(shell).toHaveAttribute('data-expanded', 'false');
    await grip.hover();
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await grip.click();
    await page.mouse.move(1200, 760);
    await expect(shell).toHaveAttribute('data-reveal', '0');
    await expect(component.locator('.overview-frame')).toHaveAttribute('inert', '');
    await component.screenshot({ path: testInfo.outputPath(`${shape}-closed.png`) });
    evidence.push({
      shape,
      compact,
      closed: await component.locator('.companion-content').evaluate((el) => ({
        clip: getComputedStyle(el).clipPath,
        rect: el.getBoundingClientRect().toJSON(),
      })),
      placement: JSON.parse((await component.getAttribute('data-preview-placement')) ?? 'null'),
    });
    await component.unmount();
    await writeFile(testInfo.outputPath('compact-notch.json'), JSON.stringify(evidence, null, 2));
  });
}
