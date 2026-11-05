import { expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import { readFile, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  DockPlacementSnapshot,
  DockPlacementTarget,
} from '../../../src/shared/dock-placement';
import {
  DOCK_FLOATING_COMPACT_SIZE,
  DOCK_FLOATING_SHADOW_MARGIN,
  DOCK_SURFACE_SIZES,
  DOCK_SURFACE_MAX_SIZE,
  dockWindowEnvelope,
  floatingDockPlacement,
  resolveFloatingDockGeometry,
  resolveDockSidePanelSurface,
  resolveDockSurface,
} from '../../../src/shared/dock-placement';
import {
  WindowOpenNewSchema,
  WindowUpdateDockPlacementSchema,
} from '../../../src/main/ipc-schemas';
import {
  cleanup,
  finish,
  launch,
  nativePointer,
  nativePointerInputs,
  prepare,
  sourceEvidence,
} from './harness';

test.beforeAll(prepare);
test.afterAll(cleanup);

test('conversation handoff wire: optional bounded exact agent identifier', () => {
  const request = { route: '/workspace/workspace-1', reuseExistingWorkspace: true };
  expect(WindowOpenNewSchema.parse(request)).not.toHaveProperty('agentId');
  expect(WindowOpenNewSchema.parse({ ...request, agentId: 'agent-1' })).toHaveProperty(
    'agentId',
    'agent-1',
  );
  for (const agentId of ['', 'a'.repeat(257), 42, null]) {
    expect(WindowOpenNewSchema.safeParse({ ...request, agentId }).success).toBe(false);
  }
});

test('side conversation geometry: bounded panel and validated resize wire', async ({}, testInfo) => {
  const observations: unknown[] = [];
  const resize = { action: 'resize', revision: 1, width: 40, height: 144 };
  expect(WindowUpdateDockPlacementSchema.parse(resize)).not.toHaveProperty('sidePanelSize');
  expect(WindowUpdateDockPlacementSchema.parse({ ...resize, sidePanelSize: null })).toHaveProperty(
    'sidePanelSize',
    null,
  );
  expect(
    WindowUpdateDockPlacementSchema.parse({
      ...resize,
      sidePanelSize: { width: 420, height: 520 },
    }),
  ).toHaveProperty('sidePanelSize', { width: 420, height: 520 });
  for (const width of [NaN, Infinity, -1, 0, 23, DOCK_SURFACE_MAX_SIZE + 1]) {
    expect(
      WindowUpdateDockPlacementSchema.safeParse({
        ...resize,
        sidePanelSize: { width, height: 520 },
      }).success,
    ).toBe(false);
  }
  for (const area of [
    { x: 0, y: 33, width: 1440, height: 867 },
    { x: -1920, y: -960, width: 1920, height: 1040 },
    { x: -320, y: 40, width: 320, height: 180 },
  ]) {
    const display = { id: 1, bounds: { ...area }, workArea: { ...area }, cutout: null };
    for (const side of ['left', 'right'] as const) {
      for (const along of [0, 0.5, 1]) {
        const rail = resolveDockSurface({ kind: 'edge', displayId: 1, side, along }, display, {
          width: 40,
          height: 144,
        });
        const before = { ...rail };
        const panel = resolveDockSidePanelSurface(
          rail,
          display,
          { width: 420, height: 520 },
          side,
        )!;
        expect(rail).toEqual(before);
        expect(panel.width).toBe(Math.min(420, area.width - 48));
        expect(panel.height).toBe(Math.min(520, area.height));
        expect(panel.y).toBeGreaterThanOrEqual(area.y);
        expect(panel.y + panel.height).toBeLessThanOrEqual(area.y + area.height);
        if (side === 'left') expect(panel.x).toBe(rail.x + rail.width + 8);
        else expect(panel.x + panel.width).toBe(rail.x - 8);
        for (const forwarding of [true, false]) {
          const bounds = dockWindowEnvelope(rail, display, null, side, forwarding, 24, panel);
          const margin = forwarding ? 64 : 0;
          expect(bounds.x).toBeLessThanOrEqual(Math.max(area.x, panel.x - margin));
          expect(bounds.y).toBeLessThanOrEqual(Math.max(area.y, panel.y - margin));
          expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(
            Math.min(area.x + area.width, panel.x + panel.width + margin),
          );
          expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(
            Math.min(area.y + area.height, panel.y + panel.height + margin),
          );
          observations.push({ display, side, along, rail, panel, forwarding, bounds });
        }
      }
    }
  }
  const tinyDisplay = {
    id: 1,
    bounds: { x: 0, y: 0, width: 40, height: 100 },
    workArea: { x: 0, y: 0, width: 40, height: 100 },
    cutout: null,
  };
  expect(
    resolveDockSidePanelSurface(
      { x: 0, y: 0, width: 40, height: 80 },
      tinyDisplay,
      { width: 420, height: 520 },
      'left',
    ),
  ).toBeNull();
  await writeFile(
    testInfo.outputPath('side-conversation-geometry.json'),
    JSON.stringify(observations, null, 2),
  );
});

test('conversation resize geometry: direction stays anchored and native bounds remain authoritative', async ({}, testInfo) => {
  const observations: unknown[] = [];
  const command = {
    action: 'resize',
    revision: 1,
    width: 2400,
    height: 1800,
    sidePanelSize: { width: 2400, height: 1800 },
  };
  expect(WindowUpdateDockPlacementSchema.parse(command)).not.toHaveProperty('expansionDirection');
  for (const expansionDirection of ['up', 'down', null]) {
    expect(
      WindowUpdateDockPlacementSchema.parse({ ...command, expansionDirection }),
    ).toHaveProperty('expansionDirection', expansionDirection);
  }
  expect(
    WindowUpdateDockPlacementSchema.safeParse({ ...command, expansionDirection: 'left' }).success,
  ).toBe(false);
  for (const width of [NaN, Infinity, DOCK_SURFACE_MAX_SIZE + 1]) {
    expect(WindowUpdateDockPlacementSchema.safeParse({ ...command, width }).success).toBe(false);
  }
  for (const area of [
    { x: 0, y: 33, width: 3440, height: 1407 },
    { x: -1920, y: -960, width: 1920, height: 1040 },
    { x: -280, y: 40, width: 280, height: 180 },
  ]) {
    const display = { id: 1, bounds: { ...area }, workArea: { ...area }, cutout: null };
    for (const direction of ['up', 'down'] as const) {
      const placement = { kind: 'floating' as const, displayId: 1, x: 0.75, y: 0.5 };
      const anchor = resolveFloatingDockGeometry(
        placement,
        display,
        DOCK_FLOATING_COMPACT_SIZE,
      ).anchor;
      for (const size of [
        { width: 320, height: 340 },
        { width: 2400, height: 1800 },
        { width: 420, height: 560 },
      ]) {
        const resolved = resolveFloatingDockGeometry(placement, display, size, direction);
        expect(resolved.anchor).toEqual(anchor);
        expect(resolved.expansionDirection).toBe(direction);
        expect(resolved.surface.x).toBeGreaterThanOrEqual(area.x);
        expect(resolved.surface.x + resolved.surface.width).toBeLessThanOrEqual(
          area.x + area.width,
        );
        expect(resolved.surface.y).toBeGreaterThanOrEqual(area.y);
        expect(resolved.surface.y + resolved.surface.height).toBeLessThanOrEqual(
          area.y + area.height,
        );
        if (direction === 'up')
          expect(resolved.surface.y + resolved.surface.height).toBe(anchor.y + anchor.height);
        else expect(resolved.surface.y).toBe(anchor.y);
        observations.push({ display, direction, size, resolved });
      }
    }
  }
  await writeFile(
    testInfo.outputPath('conversation-resize-geometry.json'),
    JSON.stringify(observations, null, 2),
  );
});

test('floating drop geometry: compact width and drop anchor remain exact at work-area boundaries', async ({}, testInfo) => {
  const observations: unknown[] = [];
  expect(DOCK_FLOATING_COMPACT_SIZE).toEqual({ width: 224, height: 40 });
  expect(DOCK_FLOATING_COMPACT_SIZE).toEqual(DOCK_SURFACE_SIZES.dragging);
  for (const area of [
    { x: 0, y: 33, width: 1440, height: 867 },
    { x: -1920, y: -960, width: 1920, height: 1040 },
    { x: -640, y: 40, width: 640, height: 180 },
    { x: -180, y: -30, width: 180, height: 30 },
  ]) {
    const display = { id: 1, bounds: { ...area }, workArea: { ...area }, cutout: null };
    for (const x of [0, 0.5, 1]) {
      for (const y of [0, 0.5, 1]) {
        const dragging = resolveDockSurface(
          { kind: 'floating', displayId: display.id, x, y },
          display,
          DOCK_SURFACE_SIZES.dragging,
        );
        // The native end-drag branch persists this same compact-size rectangle.
        const committed = floatingDockPlacement(
          { ...dragging, ...DOCK_FLOATING_COMPACT_SIZE },
          display,
        );
        const collapsed = resolveFloatingDockGeometry(
          committed,
          display,
          DOCK_FLOATING_COMPACT_SIZE,
        );
        expect(collapsed.anchor).toEqual(dragging);
        expect(collapsed.surface).toEqual(dragging);
        for (const size of [
          { width: 380, height: 520 },
          DOCK_FLOATING_COMPACT_SIZE,
          { width: 420, height: 320 },
          DOCK_FLOATING_COMPACT_SIZE,
        ]) {
          const resolved = resolveFloatingDockGeometry(committed, display, size);
          expect(resolved.anchor).toEqual(dragging);
          expect(resolved.surface.x).toBeLessThanOrEqual(dragging.x);
          expect(resolved.surface.x + resolved.surface.width).toBeGreaterThanOrEqual(
            dragging.x + dragging.width,
          );
          expect(resolved.surface.y).toBeLessThanOrEqual(dragging.y);
          expect(resolved.surface.y + resolved.surface.height).toBeGreaterThanOrEqual(
            dragging.y + dragging.height,
          );
        }
        observations.push({ display, dragging, committed, collapsed });
      }
    }
  }
  await writeFile(
    testInfo.outputPath('floating-drop-geometry.json'),
    JSON.stringify(observations, null, 2),
  );
});

test('floating geometry: stable compact anchor, upward fit and shadow reserve', async ({}, testInfo) => {
  const observations: unknown[] = [];
  for (const area of [
    { x: 0, y: 33, width: 1440, height: 867 },
    { x: -1920, y: -960, width: 1920, height: 1040 },
    { x: -800, y: 40, width: 640, height: 180 },
  ]) {
    const display = { id: 1, bounds: { ...area }, workArea: { ...area }, cutout: null };
    for (const x of [0, 0.5, 1]) {
      for (const y of [0, 0.5, 1]) {
        const placement = { kind: 'floating' as const, displayId: 1, x, y };
        const compact = resolveFloatingDockGeometry(placement, display, DOCK_FLOATING_COMPACT_SIZE);
        const expanded = resolveFloatingDockGeometry(placement, display, {
          width: 380,
          height: 420,
        });
        expect(expanded.anchor).toEqual(compact.anchor);
        expect(expanded.surface.x).toBeGreaterThanOrEqual(area.x);
        expect(expanded.surface.y).toBeGreaterThanOrEqual(area.y);
        expect(expanded.surface.x + expanded.surface.width).toBeLessThanOrEqual(
          area.x + area.width,
        );
        expect(expanded.surface.y + expanded.surface.height).toBeLessThanOrEqual(
          area.y + area.height,
        );
        expect(expanded.anchor.x).toBeGreaterThanOrEqual(expanded.surface.x);
        expect(expanded.anchor.x + expanded.anchor.width).toBeLessThanOrEqual(
          expanded.surface.x + expanded.surface.width,
        );
        if (y === 0) expect(expanded.expansionDirection).toBe('down');
        if (y === 1) {
          expect(expanded.expansionDirection).toBe('up');
          expect(expanded.surface.y + expanded.surface.height).toBe(
            expanded.anchor.y + expanded.anchor.height,
          );
        }
        for (const height of [420, 300, 40, 420, 40]) {
          expect(
            resolveFloatingDockGeometry(placement, display, {
              width: height === 40 ? DOCK_FLOATING_COMPACT_SIZE.width : 380,
              height,
            }).anchor,
          ).toEqual(compact.anchor);
        }
        const envelope = dockWindowEnvelope(
          expanded.surface,
          display,
          null,
          null,
          true,
          DOCK_FLOATING_SHADOW_MARGIN,
        );
        expect(envelope.x).toBe(Math.max(area.x, expanded.surface.x - 64));
        expect(envelope.y).toBe(Math.max(area.y, expanded.surface.y - 64));
        expect(envelope.x + envelope.width).toBe(
          Math.min(area.x + area.width, expanded.surface.x + expanded.surface.width + 64),
        );
        expect(envelope.y + envelope.height).toBe(
          Math.min(area.y + area.height, expanded.surface.y + expanded.surface.height + 64),
        );
        observations.push({ area, placement, compact, expanded, envelope });
      }
    }
  }
  await writeFile(
    testInfo.outputPath('floating-geometry.json'),
    JSON.stringify(observations, null, 2),
  );
});

for (const theme of ['light', 'dark'] as const) {
  test(`focus refinement: ${theme} neutral keyboard and quiet pointer`, async ({}, testInfo) => {
    const { app, page, profile } = await launch(testInfo, undefined, 'notch');
    const observations: unknown[] = [];
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate((value) => {
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(value);
      }, theme);
      const grip = page.getByTestId('dock-drag-handle');
      const captureFocus = async (label: string) => {
        const style = await page.evaluate(() => {
          const element = document.activeElement!;
          const s = getComputedStyle(element);
          return {
            label: element.getAttribute('aria-label'),
            visible: element.matches(':focus-visible'),
            outline: s.outlineStyle,
            outlineWidth: s.outlineWidth,
            shadow: s.boxShadow,
            background: s.backgroundColor,
          };
        });
        observations.push({ label, style });
        // Keyboard focus remains visibly indicated without pinning its decoration.
        expect(style.visible).toBe(true);
        await artifact(page, testInfo, `${theme}-${label}`);
      };
      await page.keyboard.press('Tab');
      await grip.focus();
      await expect(page.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
      for (const count of [2, 12]) {
        await page.evaluate(
          (n) => (window as any).companionFixture.setUpdateWorkspaceCount(n, false),
          count,
        );
        const overview = page.getByTestId('dock-overview');
        await expect(overview.locator('[data-dock-row]')).toHaveCount(count + 1);
        const scroller = overview.locator('[data-dock-scroll]');
        const lastWorkspace = scroller.locator('[data-dock-row]').last();
        await lastWorkspace.focus();
        await expect(lastWorkspace).toBeFocused();
        // The focused workspace and pinned Assistant remain inside their live containers.
        await expect
          .poll(() =>
            overview.evaluate((element) => {
              const scroll = element.querySelector('[data-dock-scroll]')!;
              const focused = document.activeElement!;
              const assistant = element.querySelector('[data-workspace-id="dock:assistant"]')!;
              const contains = (host: Element, child: Element) => {
                const a = host.getBoundingClientRect();
                const b = child.getBoundingClientRect();
                return (
                  b.left >= a.left - 1 &&
                  b.right <= a.right + 1 &&
                  b.top >= a.top - 1 &&
                  b.bottom <= a.bottom + 1
                );
              };
              return contains(scroll, focused) && contains(element, assistant);
            }),
          )
          .toBe(true);
        const p = await placement(page);
        const contrast = await page
          .locator('[data-testid="dock-overview"] [data-dock-row] .row-copy > :first-child')
          .first()
          .evaluate((title) => {
            const color = getComputedStyle(title).color;
            const fill = getComputedStyle(document.querySelector('.shell-silhouette path')!).fill;
            const luminance = (css: string) => {
              const rgb = css
                .match(/[\d.]+/g)!
                .slice(0, 3)
                .map(Number)
                .map((n) => {
                  const v = n / 255;
                  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
                });
              return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
            };
            const a = luminance(color),
              b = luminance(fill);
            return { color, fill, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
          });
        expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
        observations.push({
          label: `overview-${count}`,
          surface: p.surface,
          contrast,
        });
        await artifact(page, testInfo, `${theme}-content-${count}`);
      }
      await captureFocus('notch-keyboard');
      // The grip has no keyboard menu; placement moves are native commands. A keyboard
      // user reaches the floating overview by tabbing to the grip.
      await moveMenu(page, 'floating');
      await page.keyboard.press('Tab');
      await grip.focus();
      await expect(page.getByTestId('dock-overview')).toBeVisible();
      const row = page.locator('[data-dock-row]').first();
      await row.focus();
      await captureFocus('floating-row-keyboard');
      // Rows have no feedback pen; the next row is the next keyboard stop.
      await page.locator('[data-dock-row]').nth(1).focus();
      await captureFocus('next-row-keyboard');
      // Clicking outside moves focus out, which closes the keyboard-opened overview.
      // A pointer user reopens it by hovering the dock before clicking a row.
      await page.mouse.click(8, 8);
      await page
        .getByTestId('dock-surface')
        .dispatchEvent('pointerenter', { pointerType: 'mouse' });
      await expect(page.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
      await row.click();
      const pointer = await row.evaluate((element) => {
        const s = getComputedStyle(element);
        return {
          visible: element.matches(':focus-visible'),
          outline: s.outlineStyle,
          outlineWidth: s.outlineWidth,
          shadow: s.boxShadow,
        };
      });
      observations.push({ label: 'pointer-focus', pointer });
      expect(pointer.visible).toBe(false);
      await artifact(page, testInfo, `${theme}-pointer-quiet`);
    } finally {
      await finish(app, page, testInfo, {
        ...(await provenance()),
        theme,
        rendererSynthesizedInput: true,
        observations,
      });
      await rm(profile, { recursive: true, force: true });
    }
  });
}

test('closed overview is inert and keyboard entry restores access', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo, undefined, 'notch');
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const shell = page.getByTestId('dock-shell');
    const surface = page.getByTestId('dock-surface');
    const overview = page.getByTestId('dock-overview');
    await surface.dispatchEvent('pointerenter', { pointerType: 'mouse' });
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await expect(overview).toBeVisible();
    await surface.dispatchEvent('pointerleave', { pointerType: 'mouse' });
    await expect(shell).toHaveAttribute('data-reveal', '0');
    await expect(overview).toHaveCount(1);
    expect(await overview.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true);
    await page.locator('[data-dock-row]').first().focus();
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[data-testid="dock-overview"]')),
      ),
    ).toBe(false);
    await page.keyboard.press('Tab');
    await page.getByTestId('dock-drag-handle').focus();
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await expect(overview).toBeVisible();
  } finally {
    await finish(app, page, testInfo, await provenance());
    await rm(profile, { recursive: true, force: true });
  }
});

for (const geometry of ['notch', 'none', 'unknown'] as const) {
  test(`compact refinement: ${geometry} geometry, count and keyboard access`, async ({}, testInfo) => {
    const { app, page, profile } = await launch(testInfo, undefined, geometry);
    const observations = [];
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const shell = page.getByTestId('dock-shell');
      const grip = page.getByTestId('dock-drag-handle');
      await expect(shell).toHaveAttribute('data-expanded', 'false');
      const cases =
        geometry === 'notch'
          ? [
              { count: 0, running: false },
              { count: 0, running: true },
              { count: 1, running: true },
              { count: 12, running: true },
            ]
          : [{ count: 12, running: true }];
      for (const fixtureCase of cases) {
        await page.evaluate(
          ({ count, running }) =>
            (window as any).companionFixture.setUpdateWorkspaceCount(count, running),
          fixtureCase,
        );
        const current = await observe(
          app,
          page,
          `compact-${geometry}-${fixtureCase.count}-${fixtureCase.running}`,
        );
        const metrics = await page.getByTestId('dock-surface').evaluate((surface) => {
          const box = (element: Element) => {
            const r = element.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          };
          const header = surface.querySelector('header')!;
          const status = header.querySelector('[data-testid="dock-update-count"]');
          const groups = [...(status?.querySelectorAll('[data-status-group]') ?? [])].map(
            (group) => {
              const icon = group.querySelector('[data-workspace-status]');
              const dot = group.querySelector('.workspace-status-dot');
              return {
                status: group.getAttribute('data-status-group'),
                dotStatus: icon?.getAttribute('data-workspace-status') ?? null,
                dot: dot ? box(dot) : null,
                count: Number(group.getAttribute('data-status-count')),
                text: group.textContent?.trim() ?? '',
              };
            },
          );
          return {
            header: box(header),
            logo: box(header.querySelector('[data-testid="dock-drag-handle"] svg')!),
            avatarCount: header.querySelectorAll('.avatar-stack').length,
            controls: [...header.querySelectorAll('button')].map(box),
            status: status ? box(status) : null,
            total: status ? Number(status.getAttribute('data-count')) : 0,
            label: status?.getAttribute('aria-label') ?? null,
            groups,
          };
        });
        observations.push({ ...current, metrics, fixtureCase });
        // Every glyph count (one glyph sends a 28px wing) must be accepted by main;
        // a rejected resize surfaced as the dock's "Could not open the window." banner.
        expect(
          await app.evaluate(() =>
            (globalThis as any).companionNative
              .snapshot()
              .calls.filter(
                (entry: any) =>
                  entry.boundary === 'production-placement-command' && !entry.resultPhase,
              )
              .map((entry: any) => entry.command),
          ),
        ).toEqual([]);
        for (const rect of [...metrics.controls, ...(metrics.status ? [metrics.status] : [])]) {
          expect(rect.x).toBeGreaterThanOrEqual(current.placement.surface.x);
          expect(rect.y).toBeGreaterThanOrEqual(current.placement.surface.y);
          expect(rect.x + rect.width).toBeLessThanOrEqual(
            current.placement.surface.x + current.placement.surface.width,
          );
          expect(rect.y + rect.height).toBeLessThanOrEqual(
            current.placement.surface.y + current.placement.surface.height,
          );
          const camera = current.placement.cutout;
          if (camera)
            expect(rect.x + rect.width <= camera.x || rect.x >= camera.x + camera.width).toBe(true);
        }
        if (geometry === 'notch') {
          expect(metrics.avatarCount).toBe(0);
          // One glyph per row status, no visible numbers; the counts add up to the total.
          for (const group of metrics.groups) {
            expect(group.dotStatus).toBe(group.status);
            expect(group.text).toBe('');
            expect(group.count).toBeGreaterThan(0);
          }
          expect(metrics.groups.reduce((sum, group) => sum + group.count, 0)).toBe(metrics.total);
          expect(!!metrics.label).toBe(metrics.groups.length > 0);
        } else {
          expect(current.placement.shape).toBe('top-pill');
          expect(current.placement.cutout).toBeNull();
          await expect(page.getByTestId('dock-camera-exclusion')).toHaveCount(0);
        }
        await artifact(
          page,
          testInfo,
          `compact-${geometry}-${fixtureCase.count}-${fixtureCase.running ? 'running' : 'idle'}`,
        );
      }
      // Keyboard arrival opens the overview without pointer input.
      await page.keyboard.press('Tab');
      await grip.focus();
      await expect(shell).toHaveAttribute('data-expanded', 'true');
      await expect(page.getByTestId('dock-overview')).toBeVisible();
      await expect(page.getByTestId('dock-dismiss')).toHaveCount(0);
      expect(await app.evaluate(() => (globalThis as any).companionNative.menu.isEnabled())).toBe(
        true,
      );
      observations.push(await observe(app, page, 'expanded-keyboard-access'));
      await artifact(page, testInfo, `compact-${geometry}-expanded`);
      await page.getByTestId('dock-drag-handle').focus();
      await page
        .getByTestId('dock-drag-handle')
        .press('Escape')
        .catch((error: Error) => {
          if (
            !page.isClosed() ||
            !error.message.includes('Target page, context or browser has been closed')
          )
            throw error;
        });
      await expect.poll(() => page.isClosed()).toBe(true);
      expect(await app.evaluate(() => (globalThis as any).companionNative.menu.isEnabled())).toBe(
        false,
      );
    } finally {
      await finish(app, page, testInfo, {
        ...(await provenance()),
        geometryFixture: geometry,
        finalObservation: page.isClosed() ? null : await observe(app, page, 'compact-final'),
        observations,
      });
      await rm(profile, { recursive: true, force: true });
    }
  });
}

for (const geometry of ['notch', 'none', 'unknown'] as const) {
  test(`native geometry boundary: ${geometry} has honest camera exclusion`, async ({}, testInfo) => {
    const { app, page, profile } = await launch(testInfo, undefined, geometry);
    const observations = [];
    try {
      await expect
        .poll(async () => (await placement(page)).shape)
        .toBe(geometry === 'notch' ? 'notch' : 'top-pill');
      const current = await observe(app, page, `geometry-${geometry}`);
      observations.push(current);
      reachable(current.placement, current.native.displays);
      const camera = page.getByTestId('dock-camera-exclusion');
      if (geometry === 'notch') {
        await expect(camera).toBeVisible();
        const cutout = (await camera.boundingBox())!;
        const buttons = await page.getByRole('button').evaluateAll((nodes) =>
          nodes.map((node) => {
            const r = node.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        );
        expect(
          buttons.filter(
            (r) =>
              r.width > 0 &&
              r.height > 0 &&
              r.x < cutout.x + cutout.width &&
              r.x + r.width > cutout.x &&
              r.y < cutout.y + cutout.height &&
              r.y + r.height > cutout.y,
          ),
        ).toEqual([]);
      } else {
        await expect(camera).toHaveCount(0);
        expect(current.placement.cutout).toBeNull();
      }
      await artifact(page, testInfo, `geometry-${geometry}`);
    } finally {
      await finish(app, page, testInfo, {
        ...(await provenance()),
        geometryFixture: geometry,
        observations,
      });
      await rm(profile, { recursive: true, force: true });
    }
  });
}

async function placement(page: Page): Promise<DockPlacementSnapshot> {
  return page.evaluate(() => window.electronAPI!.invoke('window:get-dock-placement', {}));
}
async function observe(app: ElectronApplication, page: Page, label: string) {
  const native = await app.evaluate(() => (globalThis as any).companionNative.snapshot());
  expect(native.bounds, `${label}: actual BrowserWindow bounds match native snapshot`).toEqual(
    native.placement.windowBounds,
  );
  return {
    label,
    native,
    placement: await placement(page),
    renderer: await page.evaluate(() => (window as any).companionFixture.evidence()),
  };
}
function absoluteSurface(p: DockPlacementSnapshot, preview = false) {
  const rect = preview ? p.snapPreview! : p.surface;
  return { ...rect, x: p.windowBounds.x + rect.x, y: p.windowBounds.y + rect.y };
}
function reachable(
  p: DockPlacementSnapshot,
  displays: Array<{
    id: number;
    bounds: { x: number; y: number; width: number; height: number };
    workArea: { x: number; y: number; width: number; height: number };
  }>,
) {
  const display = displays.find((d) => d.id === p.displayId)!;
  const area = p.shape === 'notch' ? display.bounds : display.workArea;
  const surface = absoluteSurface(p);
  expect(surface.x).toBeGreaterThanOrEqual(area.x);
  expect(surface.y).toBeGreaterThanOrEqual(area.y);
  expect(surface.x + surface.width).toBeLessThanOrEqual(area.x + area.width);
  expect(surface.y + surface.height).toBeLessThanOrEqual(area.y + area.height);
}
/**
 * The adaptive shell has no grip placement menu (placement is drag-only; the
 * "Move to …" labels live only in the rail action menu, which the shell does not
 * wire). Send the same production placement command through the preload IPC.
 */
async function moveMenu(page: Page, target: DockPlacementTarget) {
  await page.evaluate(
    (value) =>
      window.electronAPI!.invoke('window:update-dock-placement', { action: 'move', target: value }),
    target,
  );
  await expect
    .poll(async () => {
      const p = (await placement(page)).placement;
      return p.kind === 'edge' ? p.side : p.kind;
    })
    .toBe(target === 'reset' ? 'notch' : target);
}
async function artifact(page: Page, testInfo: TestInfo, label: string) {
  const path = testInfo.outputPath(`${label}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(label, { path, contentType: 'image/png' });
}
async function provenance() {
  return {
    syntheticBackend: true,
    syntheticCapture: true,
    productionRenderer: true,
    productionPreload: true,
    productionPlacementIPC: true,
    realOSPointer: nativePointerInputs.length > 0,
    nativePointerInputs: [...nativePointerInputs],
    osCapturePermissionsTested: false,
    physicalNotchAndSpacesProven: false,
    sources: await sourceEvidence([
      'src/main/dock-window.ts',
      'src/main/dock-placement-ipc.ts',
      'src/main/dock-placement-controller.ts',
      'src/shared/dock-placement.ts',
      'src/features/hud/components/AdaptiveDockShell.svelte',
      'src/features/hud/components/DockOverview.svelte',
      'src/lib/styles/tokens.css',
      'src/lib/styles/dock-tokens.css',
      'src/preload/index.ts',
    ]),
  };
}

test('native click-through preserves another window focus', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo);
  const observations = [];
  try {
    // This case drives the real OS pointer, so main follows the real cursor.
    await app.evaluate(() => (globalThis as any).companionNative.setControlledCursor(null));
    await moveMenu(page, 'right');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('Tab');
    await page.getByTestId('dock-drag-handle').focus();
    await expect(page.getByTestId('dock-overview')).toBeVisible();
    const targetId = await app.evaluate(async () =>
      (globalThis as any).companionNative.openFocusTarget(),
    );
    const target = app.windows().find((p) => p.url().startsWith('data:'))!;
    await app.evaluate(({ BrowserWindow }, id) => {
      const dock = (globalThis as any).companionNative.native.getDockWindow();
      BrowserWindow.fromId(id)!.setBounds(dock.getBounds());
      BrowserWindow.fromId(id)!.focus();
    }, targetId);
    await target
      .getByRole('textbox', { name: 'Typing proof' })
      .fill('Typing stays in the other window.');
    const p = await placement(page);
    const visible = absoluteSurface(p);
    const through = { x: p.windowBounds.x + 10, y: p.windowBounds.y + p.windowBounds.height / 2 };
    expect(through.x).toBeLessThan(visible.x);
    await nativePointer('move', through);
    await nativePointer('down', through);
    await nativePointer('up', through);
    await expect(target.getByRole('button', { name: 'Click-through proof' })).toHaveAttribute(
      'data-clicks',
      '1',
    );
    await expect(target.getByRole('textbox')).toHaveValue('Typing stays in the other window.');
    expect(await app.evaluate(() => (globalThis as any).companionNative.snapshot().focused)).toBe(
      false,
    );
    observations.push(await observe(app, page, 'transparent-envelope-click-reaches-other-window'));
  } finally {
    await finish(app, page, testInfo, { ...(await provenance()), observations });
    await rm(profile, { recursive: true, force: true });
  }
});

test('keyboard placements retain renderer identity, bounded content, and user choice after relaunch', async ({}, testInfo) => {
  const first = await launch(testInfo);
  let live = first;
  const observations = [];
  try {
    const initial = await observe(first.app, first.page, 'default');
    observations.push(initial);
    expect(initial.placement.placement.kind).toBe('notch');
    reachable(initial.placement, initial.native.displays);
    for (const target of ['left', 'right', 'floating', 'notch', 'floating'] as const) {
      await moveMenu(first.page, target);
      const next = await observe(first.app, first.page, target);
      observations.push(next);
      expect(next.native.id).toBe(initial.native.id);
      expect(next.native.webContentsId).toBe(initial.native.webContentsId);
      expect(next.renderer.marker).toBe(initial.renderer.marker);
      expect(next.renderer.opened).toEqual([]);
      expect(next.native.alwaysOnTop).toBe(true);
      reachable(next.placement, next.native.displays);
      if (target === 'floating') {
        const overview = first.page.getByTestId('dock-overview');
        const rows = overview.locator('[data-dock-row]');
        const scroller = overview.locator('[data-dock-scroll]');
        const workspaceRows = scroller.locator('[data-dock-row]');
        const assistant = overview.locator('[data-workspace-id="dock:assistant"]');
        // A native move leaves the dock compact; a keyboard user opens it by tabbing to the grip.
        await first.page.keyboard.press('Tab');
        await first.page.getByTestId('dock-drag-handle').focus();
        await expect(overview).toBeVisible();
        await expect(first.page.getByTestId('dock-overflow-button')).toHaveCount(0);
        // The shared twelve-overflow fixture contains 48 workspaces plus Assistant.
        await expect(rows).toHaveCount(49);
        await expect(workspaceRows.last()).toHaveAttribute(
          'data-workspace-id',
          'dock-preview-workspace-48',
        );
        await rows.first().focus();
        await rows.first().press('End');
        await expect(assistant).toBeFocused();
        await assistant.press('ArrowUp');
        await expect(workspaceRows.last()).toBeFocused();
        await expect
          .poll(() =>
            scroller.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              const last = element.querySelectorAll('[data-dock-row]');
              const row = last[last.length - 1].getBoundingClientRect();
              const assistant = element
                .closest('[data-testid="dock-overview"]')!
                .querySelector('[data-workspace-id="dock:assistant"]')!
                .getBoundingClientRect();
              return {
                scrollable: element.scrollHeight > element.clientHeight,
                scrolled: element.scrollTop > 0,
                bounded:
                  bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1,
                lastRowRevealed: row.top >= bounds.top - 1 && row.bottom <= bounds.bottom + 1,
                assistantVisible: assistant.top >= 0 && assistant.bottom <= window.innerHeight + 1,
                windowStayedStill: window.scrollX === 0 && window.scrollY === 0,
              };
            }),
          )
          .toEqual({
            scrollable: true,
            scrolled: true,
            bounded: true,
            lastRowRevealed: true,
            assistantVisible: true,
            windowStayedStill: true,
          });
      }
      await artifact(first.page, testInfo, `keyboard-${target}`);
    }
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(first.profile, 'local-prefs.json'), 'utf8')).dockPlacement
            ?.placement?.kind,
      )
      .toBe('floating');
    const saved = JSON.parse(
      await readFile(join(first.profile, 'local-prefs.json'), 'utf8'),
    ).dockPlacement;
    await finish(first.app, first.page, testInfo, { ...(await provenance()), observations, saved });
    live = await launch(testInfo, first.profile);
    await expect.poll(async () => (await placement(live.page)).placement).toEqual(saved.placement);
    observations.push(await observe(live.app, live.page, 'relaunch'));
    await artifact(live.page, testInfo, 'relaunch-floating');
  } finally {
    await finish(live.app, live.page, testInfo, { ...(await provenance()), observations });
    await rm(first.profile, { recursive: true, force: true });
  }
});

/**
 * The dock composer's capture, through the production session (begin + capture)
 * and the dock's own preload bridge. The pending capture is left on the page.
 */
async function startComposerCapture(page: Page, workspaceId: string) {
  await page.evaluate(async (workspace) => {
    const scope = {
      workspaceId: workspace,
      agentId: 'placement-agent',
      draftId: 'placement-draft',
    };
    const begun = (await window.electronAPI!.invoke('dock-evidence:begin', scope)) as {
      ok: boolean;
      value?: Record<string, string>;
    };
    if (!begun.ok || !begun.value)
      throw new Error(`Composer capture refused: ${JSON.stringify(begun)}`);
    (window as any).capturePromise = window.electronAPI!.invoke('dock-evidence:capture', {
      ...begun.value,
      requestId: crypto.randomUUID(),
      source: 'capture',
    });
  }, workspaceId);
}

test('capture acquires visibility before async capture and rejects placement without losing the draft', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo);
  const observations = [];
  const draft = 'Preserve this capture draft while placement is locked.';
  try {
    await moveMenu(page, 'floating');
    const initial = await observe(app, page, 'before-capture');
    // The composer draft lives in this dock document; it survives only if the document does.
    await page.evaluate((text) => Object.assign(window, { __composerDraft: text }), draft);
    await app.evaluate(() => (globalThis as any).companionNative.capture.hold(true));
    await startComposerCapture(page, 'placement-qa');
    await expect.poll(async () => (await placement(page)).captureHidden).toBe(true);
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).companionNative.snapshot().visible))
      .toBe(false);
    await page.evaluate(() =>
      window.electronAPI!.invoke('window:update-dock-placement', {
        action: 'move',
        target: 'left',
      }),
    );
    expect((await placement(page)).placement).toEqual(initial.placement.placement);
    observations.push(await observe(app, page, 'capture-hidden-placement-rejected'));
    await app.evaluate(() => (globalThis as any).companionNative.capture.release());
    expect(await page.evaluate(() => (window as any).capturePromise)).toMatchObject({ ok: true });
    await expect.poll(async () => (await placement(page)).captureHidden).toBe(false);
    const restored = await observe(app, page, 'capture-restored');
    observations.push(restored);
    expect(restored.placement.placement).toEqual(initial.placement.placement);
    expect(restored.native.id).toBe(initial.native.id);
    expect(restored.renderer.marker).toBe(initial.renderer.marker);
    expect(restored.native.visible).toBe(true);
    expect(await page.evaluate(() => (window as any).__composerDraft)).toBe(draft);
    await artifact(page, testInfo, 'capture-restored');
  } finally {
    await app.evaluate(() => (globalThis as any).companionNative.capture.release());
    await finish(app, page, testInfo, { ...(await provenance()), observations });
    await rm(profile, { recursive: true, force: true });
  }
});

for (const seed of ['invalid-json', 'invalid-shape', 'missing-display'] as const) {
  test(`preferences recover a reachable placement: ${seed}`, async ({}, testInfo) => {
    const profile = await mkdtemp(join(tmpdir(), 'intent-placement-pref-'));
    await writeFile(
      join(profile, 'local-prefs.json'),
      seed === 'invalid-json'
        ? '{broken'
        : JSON.stringify({
            dockPlacement:
              seed === 'invalid-shape'
                ? { version: 99, placement: { kind: 'floating', x: 'bad' } }
                : { version: 1, placement: { kind: 'floating', displayId: -999999, x: 1, y: 1 } },
          }),
    );
    const { app, page } = await launch(testInfo, profile);
    const observations = [];
    try {
      const current = await observe(app, page, seed);
      observations.push(current);
      reachable(current.placement, current.native.displays);
      expect(current.placement.placement.kind).toBe(
        seed === 'missing-display' ? 'floating' : 'notch',
      );
      if (seed === 'missing-display') expect(current.placement.placement.displayId).toBe(-999999);
      await artifact(page, testInfo, seed);
    } finally {
      await finish(app, page, testInfo, { ...(await provenance()), observations });
      await rm(profile, { recursive: true, force: true });
    }
  });
}

async function reopenFromMenu(app: ElectronApplication): Promise<Page> {
  const opened = app.waitForEvent('window');
  await app.evaluate(() => (globalThis as any).companionNative.menu.setEnabled(true));
  const page = await opened;
  await page.waitForURL('**/dock');
  await expect(page.getByTestId('dock-surface')).toBeVisible();
  return page;
}

async function savedPreferences(profile: string) {
  return JSON.parse(await readFile(join(profile, 'local-prefs.json'), 'utf8'));
}

test('dismissal: Escape closes the native window and menu reopen retains placement', async ({}, testInfo) => {
  const first = await launch(testInfo);
  let page = first.page;
  const { app, profile } = first;
  const observations = [];
  try {
    await page.evaluate(() =>
      window.electronAPI!.invoke('window:update-dock-placement', {
        action: 'move',
        target: 'floating',
      }),
    );
    const initial = await observe(app, page, 'floating-before-dismissal');
    const expectedPlacement = initial.placement.placement;
    for (const method of ['Escape'] as const) {
      await expect(page.getByTestId('dock-dismiss')).toHaveCount(0);
      const grip = page.getByTestId('dock-drag-handle');
      await grip.focus();
      expect(await app.evaluate(() => (globalThis as any).companionNative.menu.isEnabled())).toBe(
        true,
      );
      await artifact(page, testInfo, `dismiss-${method}-before`);
      const closed = page.waitForEvent('close');
      // Escape dismisses on keydown; the window can close before the synthetic keyup.
      await page.keyboard.press('Escape').catch(() => {});
      await closed;
      await expect
        .poll(() => app.evaluate(() => (globalThis as any).companionNative.menu.isEnabled()))
        .toBe(false);
      await expect.poll(async () => (await savedPreferences(profile)).dockEnabled).toBe(false);
      expect((await savedPreferences(profile)).dockPlacement.placement).toEqual(expectedPlacement);
      observations.push({
        label: `${method}-closed`,
        native: await app.evaluate(() => (globalThis as any).companionNative.snapshot()),
        preferences: await savedPreferences(profile),
      });
      const closedVideo = await page.video()?.path();
      if (closedVideo)
        await testInfo.attach(`Dismiss ${method} renderer recording`, {
          path: closedVideo,
          contentType: 'video/webm',
        });
      page = await reopenFromMenu(app);
      await expect.poll(async () => (await placement(page)).placement).toEqual(expectedPlacement);
      await expect.poll(async () => (await savedPreferences(profile)).dockEnabled).toBe(true);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
        1,
      );
      observations.push(await observe(app, page, `${method}-reopened`));
    }
    await artifact(page, testInfo, 'dismissal-reopened-floating');
  } finally {
    await finish(app, page, testInfo, {
      ...(await provenance()),
      rendererSynthesizedInput: true,
      observations,
    });
    await rm(profile, { recursive: true, force: true });
  }
});

test('dismissal: capture ownership rejects close and preserves draft and placement', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo);
  const observations = [];
  const draft = 'Keep this draft while the companion is capture-owned.';
  try {
    await moveMenu(page, 'floating');
    const initial = await observe(app, page, 'before-capture-dismissal');
    await page.evaluate((text) => Object.assign(window, { __composerDraft: text }), draft);
    await app.evaluate(() => (globalThis as any).companionNative.capture.hold(true));
    await startComposerCapture(page, 'placement-qa');
    await expect.poll(async () => (await placement(page)).captureHidden).toBe(true);
    await page.evaluate(() =>
      window.electronAPI!.invoke('window:update-dock-placement', { action: 'dismiss' }),
    );
    expect(await app.evaluate(() => (globalThis as any).companionNative.menu.isEnabled())).toBe(
      true,
    );
    expect((await placement(page)).placement).toEqual(initial.placement.placement);
    expect(await app.evaluate(() => (globalThis as any).companionNative.snapshot().id)).toBe(
      initial.native.id,
    );
    observations.push(await observe(app, page, 'capture-owned-dismissal-rejected'));
    await app.evaluate(() => (globalThis as any).companionNative.capture.release());
    expect(await page.evaluate(() => (window as any).capturePromise)).toMatchObject({ ok: true });
    await expect.poll(async () => (await placement(page)).captureHidden).toBe(false);
    const restored = await observe(app, page, 'capture-dismissal-restored');
    observations.push(restored);
    expect(restored.native.visible).toBe(true);
    expect(restored.renderer.marker).toBe(initial.renderer.marker);
    expect(await page.evaluate(() => (window as any).__composerDraft)).toBe(draft);
    await expect(page.getByTestId('dock-dismiss')).toHaveCount(0);
  } finally {
    await app.evaluate(() => (globalThis as any).companionNative.capture.release());
    await finish(app, page, testInfo, {
      ...(await provenance()),
      rendererSynthesizedInput: true,
      observations,
    });
    await rm(profile, { recursive: true, force: true });
  }
});

test('development helper path: dist/main launch discovers staged notch helper', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo, undefined, 'notch', 'dist-main');
  const observations = [];
  try {
    await expect.poll(async () => (await placement(page)).shape).toBe('notch');
    observations.push(await observe(app, page, 'dist-main-helper-discovered'));
    await expect(page.getByTestId('dock-camera-exclusion')).toBeVisible();
    await artifact(page, testInfo, 'dev-dist-main-notch');
  } finally {
    await finish(app, page, testInfo, {
      ...(await provenance()),
      helperOutputSynthetic: true,
      observations,
    });
    await rm(profile, { recursive: true, force: true });
  }
});

test('native inactive cursor: AppKit hand application preserves keyboard focus', async ({}, testInfo) => {
  const sources = await sourceEvidence([
    'src/main/dock-cursor.ts',
    'src/main/dock-window.ts',
    'resources/dock/cursor.mm',
    'resources/dock-helper/intent-dock-cursor.node',
    'scripts/build-dock-helper.cjs',
    'test/fixtures/dock-placement-native/harness.ts',
    'test/fixtures/dock-placement-native/placement.electron.ts',
  ]);
  const { app, page } = await launch(testInfo);
  const observations: unknown[] = [];
  try {
    const initial = await app.evaluate(async ({ BrowserWindow, screen }) => {
      const fixture = (globalThis as any).companionNative;
      fixture.setControlledCursor(null);
      const point = screen.getCursorScreenPoint();
      fixture.native.closeDockWindow();
      const focusId = await fixture.openFocusTarget();
      const focusTarget = BrowserWindow.fromId(focusId)!;
      const target = new BrowserWindow({
        x: Math.floor(point.x) - 60,
        y: Math.floor(point.y) - 40,
        width: 120,
        height: 80,
        show: false,
        frame: false,
        roundedCorners: false,
        enableLargerThanScreen: true,
        alwaysOnTop: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      });
      await target.loadURL('data:text/html,<body style="margin:0;background:black;cursor:grab">');
      target.setAlwaysOnTop(true, 'status');
      target.showInactive();
      focusTarget.focus();
      const controller = fixture.native.attachDockCursor(target);
      if (!controller) throw new Error('Real AppKit dock cursor adapter was not loaded');
      const state = {
        enabled: true,
        regions: [{ x: 0, y: 0, width: 120, height: 80 }],
        excludedRegions: [],
        revision: 1,
      };
      fixture.inactiveCursorProof = { target, controller, focusTarget, state };
      return { point, native: controller.inspect(), focusId, targetId: target.id };
    });
    observations.push({ label: 'native-window-under-stationary-pointer', ...initial });
    const snapshot = () =>
      app.evaluate(() => {
        const proof = (globalThis as any).companionNative.inactiveCursorProof;
        return {
          native: proof.controller.inspect(),
          targetFocused: proof.target.isFocused(),
          focusTargetFocused: proof.focusTarget.isFocused(),
        };
      });
    await expect.poll(async () => (await snapshot()).focusTargetFocused).toBe(true);
    for (const kind of ['grab', 'grabbing'] as const) {
      // This is a controlled renderer-cursor callback, not physical pointer input.
      // The adapter uses the real NSEvent position and applies the real NSCursor.
      await app.evaluate((_electron, kind) => {
        const proof = (globalThis as any).companionNative.inactiveCursorProof;
        proof.controller.update(proof.state);
        proof.controller.cursorChanged(kind);
      }, kind);
      await expect.poll(async () => (await snapshot()).native.currentSystemCursor).toBe(kind);
      const applied = await snapshot();
      observations.push({ label: kind, controlledCursorCallback: true, ...applied });
      expect(applied.native.windowKey).toBe(false);
      expect(applied.targetFocused).toBe(false);
      expect(applied.focusTargetFocused).toBe(true);
      expect(applied.native.lastApplied).toBe(kind);
      expect(applied.native.setCount).toBeGreaterThan(0);
      expect(applied.native.ownsCursor).toBe(true);
      const duplicate = await app.evaluate((_electron, kind) => {
        const proof = (globalThis as any).companionNative.inactiveCursorProof;
        for (let i = 0; i < 5; i++) {
          proof.controller.update(proof.state);
          proof.controller.cursorChanged(kind);
        }
        return proof.controller.inspect();
      }, kind);
      expect(duplicate.setCount).toBe(applied.native.setCount);
    }
    const excluded = await app.evaluate(() => {
      const proof = (globalThis as any).companionNative.inactiveCursorProof;
      const point = proof.controller.inspect().point;
      proof.controller.update({
        ...proof.state,
        excludedRegions: [{ x: point.x - 2, y: point.y - 2, width: 4, height: 4 }],
      });
      return proof.controller.inspect();
    });
    observations.push({ label: 'camera-exclusion-at-real-pointer', native: excluded });
    expect(excluded.ownsCursor).toBe(false);
    expect(excluded.currentSystemCursor).toBe('arrow');
    const disabled = await app.evaluate(() => {
      const proof = (globalThis as any).companionNative.inactiveCursorProof;
      proof.controller.update({ ...proof.state, enabled: false });
      proof.controller.cursorChanged('grab');
      return proof.controller.inspect();
    });
    observations.push({ label: 'disabled-routing', native: disabled });
    expect(disabled.ownsCursor).toBe(false);
    expect(disabled.tracking).toBe(false);
    const disposed = await app.evaluate(() => {
      const proof = (globalThis as any).companionNative.inactiveCursorProof;
      proof.controller.dispose();
      const before = proof.controller.inspect();
      proof.controller.update(proof.state);
      proof.controller.cursorChanged('grab');
      const after = proof.controller.inspect();
      proof.target.close();
      return { before, after, focusTargetFocused: proof.focusTarget.isFocused() };
    });
    observations.push({ label: 'disposed', ...disposed });
    expect(disposed.after.disposed).toBe(true);
    expect(disposed.after.tracking).toBe(false);
    expect(disposed.after.setCount).toBe(disposed.before.setCount);
    expect(disposed.focusTargetFocused).toBe(true);
  } finally {
    await app
      .evaluate(() => {
        const proof = (globalThis as any).companionNative.inactiveCursorProof;
        proof?.controller.dispose();
        if (proof?.target && !proof.target.isDestroyed()) proof.target.close();
      })
      .catch(() => {});
    await finish(app, page, testInfo, {
      physicalPointerInput: false,
      controlledCursorCallback: true,
      actualAppKitCursor: true,
      sources,
      observations,
    });
  }
});

test('native pointer routing rejects stale revisions and recovers setter failures', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo, undefined, 'notch');
  const observations: any[] = [];
  let timeline: unknown[] = [];
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await app.evaluate(() => {
      const fixture = (globalThis as any).companionNative;
      const window = fixture.native.getDockWindow();
      const events: any[] = [];
      const originalIgnore = window.setIgnoreMouseEvents;
      const diagnostic = {
        stage: 'setup',
        lastCursor: null as string | null,
        events,
        dispose() {
          window.webContents.off('cursor-changed', changed);
          window.setIgnoreMouseEvents = originalIgnore;
        },
      };
      const changed = (_event: unknown, type: string) => {
        diagnostic.lastCursor = type;
        const state = fixture.snapshot();
        events.push({
          kind: 'cursor',
          stage: diagnostic.stage,
          type,
          time: Date.now(),
          ignored: state.ignoredPointerInput,
          routing: state.pointerRouting,
          revision: state.placement?.revision,
          bounds: state.bounds,
          point: state.cursor,
        });
      };
      window.webContents.on('cursor-changed', changed);
      window.setIgnoreMouseEvents = (ignore: boolean, options: unknown) => {
        const result = originalIgnore.call(window, ignore, options);
        events.push({
          kind: 'ignore',
          stage: diagnostic.stage,
          ignore,
          options,
          time: Date.now(),
          revision: fixture.native.getDockPlacementSnapshot(window)?.revision,
          bounds: window.getBounds(),
        });
        return result;
      };
      fixture.cursorDiagnostic = diagnostic;
      fixture.native.focusDockWindow();
    });
    await expect.poll(async () => (await placement(page)).shape).toBe('notch');
    const routingLifecycle = await app.evaluate(async () => {
      const fixture = (globalThis as any).companionNative;
      const native = fixture.native;
      const window = native.getDockWindow();
      const diagnostic = fixture.cursorDiagnostic;
      const snapshot = () => native.getDockPlacementSnapshot(window);
      const route = (active: boolean, revision = snapshot().revision) => {
        const current = snapshot();
        fixture.setControlledCursor({
          x: current.windowBounds.x + current.surface.x + 20,
          y: current.windowBounds.y + current.surface.y + 20,
        });
        return native.setDockPointerRegions(window, {
          active,
          regions: active ? [current.surface] : [],
          revision,
        });
      };
      const count = () => diagnostic.events.filter((event: any) => event.kind === 'ignore').length;
      diagnostic.stage = 'routing-stale';
      route(true);
      const beforeStale = count();
      const staleAccepted = route(false, snapshot().revision - 1);
      const stale = {
        accepted: staleAccepted,
        writes: count() - beforeStale,
        ignored: fixture.snapshot().ignoredPointerInput,
      };
      const errors = [];
      for (const failures of [1, 2]) {
        diagnostic.stage = `routing-error-${failures}`;
        route(true);
        const realSetter = window.setIgnoreMouseEvents;
        let remaining = failures;
        const attempts: boolean[] = [];
        window.setIgnoreMouseEvents = (...args: any[]) => {
          attempts.push(args[0]);
          if (remaining-- > 0) throw new Error('Controlled routing setter failure');
          return realSetter.apply(window, args);
        };
        try {
          const failed = route(false);
          const recovered = route(false);
          const beforeRepeat = attempts.length;
          route(false);
          errors.push({
            failures,
            failed,
            recovered,
            attempts: [...attempts],
            repeatedWrites: attempts.length - beforeRepeat,
            ignored: fixture.snapshot().ignoredPointerInput,
          });
        } finally {
          window.setIgnoreMouseEvents = realSetter;
        }
      }
      return { stale, errors };
    });
    observations.push({ label: 'routing-lifecycle', routingLifecycle });
    expect(routingLifecycle.stale).toMatchObject({
      accepted: false,
      writes: 0,
      ignored: { ignore: false },
    });
    for (const error of routingLifecycle.errors) {
      expect(error.failed).toBe(false);
      expect(error.recovered).toBe(true);
      expect(error.attempts).toEqual([true, false, true]);
      expect(error.repeatedWrites).toBe(0);
      expect(error.ignored).toMatchObject({ ignore: true, options: { forward: true } });
    }
    const recreated = await app.evaluate(async ({ BrowserWindow }) => {
      const fixture = (globalThis as any).companionNative;
      const old = fixture.native.getDockWindow();
      const oldId = old.id;
      const diagnostic = fixture.cursorDiagnostic;
      diagnostic.dispose();
      const original = BrowserWindow.prototype.setIgnoreMouseEvents;
      const calls: any[] = [];
      BrowserWindow.prototype.setIgnoreMouseEvents = function (...args: any[]) {
        calls.push({ id: this.id, ignore: args[0], forward: args[1]?.forward });
        return original.apply(this, args as [boolean, { forward?: boolean }?]);
      };
      try {
        await fixture.menu.setEnabled(false);
        await fixture.menu.setEnabled(true);
        const fresh = fixture.native.getDockWindow();
        return { oldId, newId: fresh.id, calls };
      } finally {
        BrowserWindow.prototype.setIgnoreMouseEvents = original;
      }
    });
    observations.push({ label: 'recreated-window', recreated });
    expect(recreated.newId).not.toBe(recreated.oldId);
    expect(recreated.calls.find((call: any) => call.id === recreated.newId)).toMatchObject({
      ignore: true,
      forward: true,
    });
  } finally {
    timeline = await app
      .evaluate(() => {
        const fixture = (globalThis as any).companionNative;
        const diagnostic = fixture.cursorDiagnostic;
        if (!diagnostic) return [];
        diagnostic.dispose();
        delete fixture.cursorDiagnostic;
        return diagnostic.events;
      })
      .catch(() => []);
    await finish(app, page, testInfo, {
      ...(await provenance()),
      controlledCursor: true,
      chromiumPointerInput: false,
      physicalPointerInput: false,
      physicalCursorAppearanceProven: false,
      observations,
      timeline,
    });
    await rm(profile, { recursive: true, force: true });
  }
});

test('release-point wire validation and floating geometry remain bounded', async ({}, testInfo) => {
  const token = '123e4567-e89b-42d3-a456-426614174000';
  const end = { action: 'end-drag', token, sequence: 2 };
  expect(
    WindowUpdateDockPlacementSchema.parse({ ...end, releasePoint: { x: -640, y: -20 } }),
  ).toHaveProperty('releasePoint', { x: -640, y: -20 });
  for (const x of [NaN, Infinity, 1_000_001]) {
    expect(
      WindowUpdateDockPlacementSchema.safeParse({ ...end, releasePoint: { x, y: 0 } }).success,
    ).toBe(false);
  }
  const geometryCases = [
    { name: 'center', area: { x: 0, y: 32, width: 1440, height: 868 }, x: 600 },
    { name: 'right-clamped', area: { x: 0, y: 32, width: 1440, height: 868 }, x: 1400 },
    { name: 'negative-origin', area: { x: -1920, y: -1000, width: 1920, height: 1080 }, x: -900 },
  ].map(({ name, area, x }) => {
    const display = { id: 1, bounds: area, workArea: area, cutout: null };
    const placement = floatingDockPlacement(
      { x, y: area.y + 200, ...DOCK_FLOATING_COMPACT_SIZE },
      display,
    );
    const dragging = resolveDockSurface(placement, display, DOCK_FLOATING_COMPACT_SIZE);
    const idle = resolveFloatingDockGeometry(placement, display, DOCK_FLOATING_COMPACT_SIZE);
    const dragBounds = dockWindowEnvelope(
      dragging,
      display,
      null,
      null,
      true,
      DOCK_FLOATING_SHADOW_MARGIN,
    );
    const idleBounds = dockWindowEnvelope(
      idle.surface,
      display,
      null,
      null,
      true,
      DOCK_FLOATING_SHADOW_MARGIN,
    );
    expect(idle.anchor, name).toEqual(dragging);
    expect(idleBounds, name).toEqual(dragBounds);
    return { name, display, dragging, idle, dragBounds, idleBounds };
  });
  await writeFile(
    testInfo.outputPath('release-point-geometry.json'),
    JSON.stringify(geometryCases, null, 2),
  );
});

test('resize request validation rejects stale revisions and outside origins', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo);
  const observations = [];
  try {
    const result = await app.evaluate(async () => {
      const fixture = (globalThis as any).companionNative;
      const native = fixture.native;
      const window = native.getDockWindow();
      const command = (value: unknown) => native.updateDockPlacement(window, value);
      const current = () => native.getDockPlacementSnapshot(window);
      await command({ action: 'move', target: 'floating' });
      await command({ action: 'resize', revision: current().revision, width: 420, height: 560 });
      const original = current();
      await command({
        action: 'begin-resize',
        revision: original.revision - 1,
        origin: original.surface,
      });
      const stale = current();
      await command({
        action: 'begin-resize',
        revision: current().revision,
        origin: { x: -1, y: -1 },
      });
      const outside = current();
      return { stale, outside };
    });
    observations.push(result);
    expect(result.stale.resizeToken).toBeNull();
    expect(result.outside.resizeToken).toBeNull();
  } finally {
    await finish(app, page, testInfo, {
      ...(await provenance()),
      directTrackedNativeCommands: true,
      controlledOSCursor: true,
      observations,
    });
    await rm(profile, { recursive: true, force: true });
  }
});

test('controlled drag validation: stale, outside, nonfinite and camera origins cannot start dragging', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo, undefined, 'notch');
  const observations = [];
  try {
    const initial = await placement(page);
    const cutout = initial.cutout!;
    const cases = [
      { label: 'stale-revision', revision: 0, origin: { x: 12, y: 12 } },
      { label: 'outside-width', origin: { x: initial.surface.width, y: 12 } },
      { label: 'outside-height', origin: { x: 12, y: initial.surface.height } },
      { label: 'negative', origin: { x: -1, y: 12 } },
      { label: 'nonfinite', origin: { x: Number.NaN, y: 12 } },
      {
        label: 'camera',
        origin: {
          x: cutout.x - initial.surface.x + cutout.width / 2,
          y: cutout.y - initial.surface.y + cutout.height / 2,
        },
      },
    ];
    for (const entry of cases) {
      const before = await placement(page);
      const result = await page.evaluate(
        async (command) => {
          try {
            return {
              response: await window.electronAPI!.invoke(
                'window:update-dock-placement',
                command as any,
              ),
            };
          } catch (error) {
            return { error: String(error) };
          }
        },
        { action: 'begin-drag', revision: entry.revision ?? before.revision, origin: entry.origin },
      );
      const after = await placement(page);
      expect(after.phase, entry.label).toBe('idle');
      expect(after.dragToken, entry.label).toBeNull();
      expect(after.placement, entry.label).toEqual(before.placement);
      observations.push({ label: entry.label, result, placement: after });
    }
  } finally {
    await finish(app, page, testInfo, {
      ...(await provenance()),
      syntheticHelperOutput: true,
      directProductionIPCValidation: true,
      observations,
    });
    await rm(profile, { recursive: true, force: true });
  }
});
