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

test('native blur: compact side grip remains interactive after unchanged re-entry', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo, undefined, 'none');
  const observations: unknown[] = [];
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() =>
      window.electronAPI!.invoke('window:update-dock-placement', {
        action: 'move',
        target: 'right',
      }),
    );
    await expect(page.getByTestId('dock-shell')).toHaveAttribute('data-side', 'right');
    const grip = page.getByTestId('dock-drag-handle');
    await grip.focus();
    const rect = (await grip.boundingBox())!;
    const local = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    await page.mouse.move(local.x, local.y);
    const initial = await placement(page);
    const point = {
      x: initial.windowBounds.x + local.x,
      y: initial.windowBounds.y + local.y,
    };
    await app.evaluate((_electron, cursor) => {
      const fixture = (globalThis as any).companionNative;
      fixture.setControlledCursor(cursor);
      fixture.native.getDockWindow().focus();
    }, point);
    await expect.poll(async () => (await observe(app, page, 'initial')).native.focused).toBe(true);
    await expect
      .poll(async () => (await observe(app, page, 'initial')).native.ignoredPointerInput?.ignore)
      .toBe(false);
    observations.push(await observe(app, page, 'before-blur'));

    await app.evaluate(() => (globalThis as any).companionNative.openFocusTarget());
    await expect.poll(async () => (await observe(app, page, 'blurred')).native.focused).toBe(false);
    await app.evaluate((_electron, bounds) => {
      (globalThis as any).companionNative.setControlledCursor({
        x: bounds.x + 8,
        y: bounds.y + 8,
      });
    }, initial.windowBounds);
    await page.mouse.move(8, 8);
    await expect
      .poll(
        async () =>
          (await observe(app, page, 'transparent-area')).native.ignoredPointerInput?.ignore,
      )
      .toBe(true);
    observations.push(await observe(app, page, 'transparent-area'));

    await app.evaluate(
      (_electron, cursor) => (globalThis as any).companionNative.setControlledCursor(cursor),
      point,
    );
    await page.mouse.move(local.x, local.y);
    const returned = await observe(app, page, 'returned-to-grip');
    observations.push(returned);
    expect(returned.placement).toEqual(initial);
    await expect
      .poll(async () => (await observe(app, page, 're-entry')).native.ignoredPointerInput?.ignore)
      .toBe(false);
    observations.push(await observe(app, page, 'interactive-after-blur'));
  } finally {
    observations.push(await observe(app, page, 'final'));
    await finish(app, page, testInfo, {
      controlledCursor: true,
      physicalPointerInput: false,
      observations,
    });
    await rm(profile, { recursive: true, force: true });
  }
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

test('motion refinement: reversible reveal, inert close and retained-envelope routing', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo, undefined, 'notch');
  const observations: unknown[] = [];
  let frames: any[] = [];
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => (window as any).companionFixture.setUpdateWorkspaceCount(12, false));
    await page.evaluate(() => (window as any).companionFixture.startMotionEvidence());
    const shell = page.getByTestId('dock-shell');
    const surface = page.getByTestId('dock-surface');
    const hover = async (open: boolean, label: string) => {
      await page.evaluate(
        (value) => (window as any).companionFixture.markMotionEvidence(value),
        label,
      );
      await surface.dispatchEvent(open ? 'pointerenter' : 'pointerleave', { pointerType: 'mouse' });
    };
    const settled = async (open: boolean) =>
      expect(shell).toHaveAttribute('data-reveal', open ? '1' : '0');
    await page.waitForTimeout(1500); // Deliberate recording pace; transition assertions follow.
    await hover(true, 'first-open');
    await settled(true);
    await expect(page.locator('[data-dock-row]')).toHaveCount(13);
    const envelope = await placement(page);
    observations.push(await observe(app, page, 'open-envelope'));
    await page.evaluate(() => (window as any).companionFixture.setUpdateWorkspaceCount(2, false));
    await expect(page.locator('[data-dock-row]')).toHaveCount(3);
    await page.waitForTimeout(1600);
    await artifact(page, testInfo, 'motion-sparse-content');
    await page.evaluate(() => (window as any).companionFixture.setUpdateWorkspaceCount(12, false));
    await expect
      .poll(async () => (await placement(page)).surface.height)
      .toBe(envelope.surface.height);
    await page.waitForTimeout(1600);
    await hover(false, 'first-close');
    await settled(false);
    expect((await placement(page)).windowBounds).toEqual(envelope.windowBounds);
    const overview = page.getByTestId('dock-overview');
    await expect(overview).toHaveCount(1);
    expect(await overview.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true);
    await page.locator('[data-dock-row]').first().focus();
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[data-testid="dock-overview"]')),
      ),
    ).toBe(false);
    const route = await app.evaluate(() => (globalThis as any).companionNative.snapshot());
    const shown = route.pointerRouting.payload.regions[0];
    const inside = {
      x: envelope.windowBounds.x + shown.x + 10,
      y: envelope.windowBounds.y + shown.y + 16,
    };
    const outside = {
      x: envelope.windowBounds.x + shown.x + 10,
      y: envelope.windowBounds.y + shown.y + 80,
    };
    // Below the closed header first: once the cursor rests in the header, main's
    // presence report opens the dock on hover and that area becomes interactive.
    for (const [label, point, ignored] of [
      ['outside', outside, true],
      ['inside', inside, false],
    ] as const) {
      await app.evaluate(
        (_electron, cursor) => (globalThis as any).companionNative.setControlledCursor(cursor),
        point,
      );
      await expect
        .poll(() =>
          app.evaluate(
            // Unrecorded means the dock's initial click-through routing (applied before
            // the harness wrapped setIgnoreMouseEvents) never changed.
            () =>
              (globalThis as any).companionNative.snapshot().ignoredPointerInput?.ignore ?? true,
          ),
        )
        .toBe(ignored);
      observations.push(await observe(app, page, `controlled-pointer-${label}`));
    }
    const exitPoint = {
      x: envelope.windowBounds.x + envelope.windowBounds.width + 400,
      y: envelope.windowBounds.y + 400,
    };
    await app.evaluate(
      (_electron, cursor) => (globalThis as any).companionNative.setControlledCursor(cursor),
      exitPoint,
    );
    // The controlled cursor changes main's poll only. Main forwarded the inside move
    // to Chromium; move that input outside too, as an actual OS exit would, so :hover
    // does not contradict the native presence report (real DOM hover takes priority).
    await page.mouse.move(
      exitPoint.x - envelope.windowBounds.x,
      exitPoint.y - envelope.windowBounds.y,
    );
    await expect.poll(() => surface.evaluate((element) => element.matches(':hover'))).toBe(false);
    await settled(false);
    await artifact(page, testInfo, 'motion-closed');
    await page.waitForTimeout(1400);
    for (let cycle = 0; cycle < 3; cycle++) {
      await hover(true, `cycle-${cycle}-open`);
      await settled(true);
      await page.waitForTimeout(500);
      await hover(false, `cycle-${cycle}-closing`);
      await page.waitForFunction(
        () => {
          const p = Number(
            document.querySelector('[data-testid="dock-shell"]')?.getAttribute('data-reveal'),
          );
          return p > 0 && p < 1;
        },
        undefined,
        { polling: 'raf' },
      );
      await hover(true, `cycle-${cycle}-reverse`);
      await settled(true);
      await page.waitForTimeout(500);
      await hover(false, `cycle-${cycle}-closed`);
      await settled(false);
      expect((await placement(page)).windowBounds).toEqual(envelope.windowBounds);
      await page.waitForTimeout(500);
    }
    frames = await page.evaluate(() => (window as any).companionFixture.stopMotionEvidence());
    const revealFrames = frames.filter((f) => f.reveal !== null);
    expect(revealFrames.some((f) => Number(f.reveal) > 0 && Number(f.reveal) < 1)).toBe(true);
    for (const f of revealFrames) {
      expect(Number.isFinite(Number(f.reveal))).toBe(true);
      expect(Number(f.reveal)).toBeGreaterThanOrEqual(0);
      expect(Number(f.reveal)).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < revealFrames.length; i++) {
      const a = revealFrames[i - 1],
        b = revealFrames[i];
      if (b.time - a.time < 40)
        expect(Math.abs(Number(b.reveal) - Number(a.reveal))).toBeLessThan(0.8);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => (window as any).companionFixture.startMotionEvidence());
    await hover(true, 'reduced-open');
    await settled(true);
    await hover(false, 'reduced-close');
    await settled(false);
    const reducedFrames = await page.evaluate(() =>
      (window as any).companionFixture.stopMotionEvidence(),
    );
    expect(reducedFrames.every((f: any) => ['0', '1'].includes(f.reveal))).toBe(true);
    observations.push({ reducedFrames });
    const beforeDrag = await observe(app, page, 'closed-before-drag');
    const grip = page.getByTestId('dock-drag-handle');
    const box = (await grip.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await app.evaluate(
      (_electron, cursor) => (globalThis as any).companionNative.setControlledCursor(cursor),
      {
        x: beforeDrag.native.bounds.x + point.x,
        y: beforeDrag.native.bounds.y + point.y,
      },
    );
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 12, point.y + 12);
    await expect.poll(async () => (await placement(page)).phase).toBe('dragging');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(async () => (await placement(page)).phase).toBe('idle');
    expect((await placement(page)).placement).toEqual(beforeDrag.placement.placement);
    observations.push(await observe(app, page, 'drag-after-close-cancelled'));
    await page.keyboard.press('Tab');
    await grip.focus();
    await settled(true);
    await expect(page.getByTestId('dock-dismiss')).toHaveCount(0);
    await artifact(page, testInfo, 'motion-keyboard-open');
  } finally {
    if (!page.isClosed()) {
      const finalFrames = await page
        .evaluate(() => (window as any).companionFixture.stopMotionEvidence())
        .catch(() => []);
      if (!frames.length) frames = finalFrames;
    }
    await finish(app, page, testInfo, {
      ...(await provenance()),
      rendererSynthesizedInput: true,
      controlledOSCursor: true,
      syntheticHoverEvents: true,
      finalObservation: page.isClosed() ? null : await observe(app, page, 'motion-final'),
      frames,
      observations,
    });
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
      if (geometry === 'notch') {
        await moveMenu(page, 'floating');
        const floated = await observe(app, page, 'before-compact-notch-snap');
        const gripBox = (await grip.boundingBox())!;
        const point = { x: gripBox.x + gripBox.width / 2, y: gripBox.y + gripBox.height / 2 };
        await app.evaluate(
          (_electron, cursor) => (globalThis as any).companionNative.setControlledCursor(cursor),
          {
            x: floated.native.bounds.x + point.x,
            y: floated.native.bounds.y + point.y,
          },
        );
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        const grabbed = await placement(page);
        // A presence report can arrive while a button is held but before the first
        // threshold move. Let that hover timer expire without changing the grab revision.
        await page
          .getByTestId('dock-surface')
          .dispatchEvent('pointerenter', { pointerType: 'mouse' });
        await page.waitForTimeout(400); // Deliberately cross the hover-open boundary.
        expect((await placement(page)).revision).toBe(grabbed.revision);

        await page.mouse.move(point.x + 12, point.y + 12);
        await expect
          .poll(() =>
            page.evaluate(() => (window as any).companionFixture.evidence().dragStartResult?.token),
          )
          .toBeTruthy();
        const display = floated.native.displays.find(
          (item: any) => item.id === floated.placement.displayId,
        )!;
        await app.evaluate(
          (_electron, cursor) => (globalThis as any).companionNative.setControlledCursor(cursor),
          {
            x: display.bounds.x + display.bounds.width / 2,
            y: display.bounds.y + 16,
          },
        );
        await expect
          .poll(async () => {
            const preview = (await placement(page)).snapPreview;
            return preview && { width: preview.width, height: preview.height };
          })
          .toEqual({ width: 380, height: 32 });
        observations.push(await observe(app, page, 'destination-camera-sized-preview'));
        // A real pointer-up happens where the cursor is; main drops at that release point.
        const dragging = await placement(page);
        await page.mouse.move(
          display.bounds.x + display.bounds.width / 2 - dragging.windowBounds.x,
          display.bounds.y + 16 - dragging.windowBounds.y,
        );
        await page.mouse.up();
        await expect.poll(async () => (await placement(page)).phase).toBe('idle');
        await expect.poll(async () => (await placement(page)).shape).toBe('notch');
        await expect
          .poll(async () => {
            const surface = (await placement(page)).surface;
            return { width: surface.width, height: surface.height };
          })
          .toEqual({ width: 380, height: 32 });
        observations.push(await observe(app, page, 'destination-camera-sized-drop'));
        await artifact(page, testInfo, 'compact-notch-after-snap');
      }
      // Keyboard arrival: a Tab press precedes focus (dragging also left the grip focused,
      // so this moves it away first). Focus without key or pointer input does not open.
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
async function screenPoint(app: ElectronApplication, page: Page) {
  const grip = (await page.getByTestId('dock-drag-handle').boundingBox())!;
  const bounds = await app.evaluate(() =>
    (globalThis as any).companionNative.native.getDockWindow().getBounds(),
  );
  return { x: bounds.x + grip.x + grip.width / 2, y: bounds.y + grip.y + grip.height / 2 };
}
async function beginDrag(app: ElectronApplication, page: Page) {
  const origin = await screenPoint(app, page);
  await nativePointer('move', origin);
  await nativePointer('down', origin);
  await nativePointer('drag', { x: origin.x + 10, y: origin.y + 2 });
  await expect.poll(async () => (await placement(page)).phase).toBe('dragging');
  return origin;
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

test('hover continuity and native click-through preserve another window focus', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo);
  const observations = [];
  try {
    // This case drives the real OS pointer, so main follows the real cursor.
    await app.evaluate(() => (globalThis as any).companionNative.setControlledCursor(null));
    await moveMenu(page, 'right');
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
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let p = await placement(page);
    const surface = absoluteSurface(p);
    const hover = { x: surface.x + surface.width / 2, y: surface.y + surface.height / 2 };
    await nativePointer('move', hover);
    await expect(page.getByTestId('dock-shell')).toHaveAttribute('data-expanded', 'true');
    expect(await app.evaluate(() => (globalThis as any).companionNative.snapshot().focused)).toBe(
      false,
    );
    const panel = (await page.getByTestId('dock-overview').boundingBox())!;
    p = await placement(page);
    await nativePointer('move', {
      x: p.windowBounds.x + panel.x + panel.width / 2,
      y: p.windowBounds.y + panel.y + panel.height / 2,
    });
    await expect(page.getByTestId('dock-overview')).toBeVisible();
    await expect(target.getByRole('textbox')).toHaveValue('Typing stays in the other window.');
    observations.push(
      await observe(app, page, 'hover-from-rail-into-overview-without-focus-steal'),
    );
    await artifact(page, testInfo, 'hover-continuity-reduced-motion');
    const activeAnimations = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running')
        .map((a) => ({
          timing: a.effect?.getComputedTiming(),
          frames: (a.effect as KeyframeEffect | null)?.getKeyframes(),
        })),
    );
    // Reduced motion may crossfade, but no perpetual moving/scaling typography.
    expect(
      activeAnimations.filter(
        (a) => a.timing?.iterations === Infinity && a.frames?.some((frame) => frame.transform),
      ),
    ).toEqual([]);
    p = await placement(page);
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

test('real native drag follows cursor, previews exact landings, and Escape rejects late commit', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo);
  const observations = [];
  try {
    // This case drives the real OS pointer, so main follows the real cursor.
    await app.evaluate(() => (globalThis as any).companionNative.setControlledCursor(null));
    await moveMenu(page, 'floating');
    const initial = await observe(app, page, 'before-drag');
    const grip = await screenPoint(app, page);
    await nativePointer('move', grip);
    await nativePointer('down', grip);
    await nativePointer('drag', { x: grip.x + 2, y: grip.y + 1 });
    await nativePointer('up', { x: grip.x + 2, y: grip.y + 1 });
    expect((await placement(page)).phase).toBe('idle');
    expect((await placement(page)).placement).toEqual(initial.placement.placement);
    expect((await observe(app, page, 'below-threshold')).renderer.opened).toEqual([]);
    const area = initial.native.displays.find(
      (d: any) => d.id === initial.placement.displayId,
    ).workArea;
    for (const target of ['left', 'right', 'floating', 'notch'] as const) {
      await beginDrag(app, page);
      const destination =
        target === 'left'
          ? { x: area.x + 3, y: area.y + area.height / 2 }
          : target === 'right'
            ? { x: area.x + area.width - 3, y: area.y + area.height / 2 }
            : target === 'notch'
              ? {
                  x: area.x + area.width / 2,
                  y: initial.placement.cutout
                    ? initial.native.displays.find((d: any) => d.id === initial.placement.displayId)
                        .bounds.y + 4
                    : area.y + 4,
                }
              : { x: area.x + area.width * 0.6, y: area.y + area.height * 0.6 };
      await nativePointer('drag', destination);
      await expect
        .poll(async () => Boolean((await placement(page)).snapPreview))
        .toBe(target !== 'floating');
      const moving = await observe(app, page, `${target}-candidate`);
      observations.push(moving);
      if (target === 'left') {
        await nativePointer('drag', { ...destination, x: area.x + 34 });
        await expect.poll(async () => Boolean((await placement(page)).snapPreview)).toBe(true);
        await nativePointer('drag', destination);
      }
      const candidate = await placement(page);
      await artifact(page, testInfo, `${target}-snap`);
      await nativePointer('up', destination);
      await expect.poll(async () => (await placement(page)).phase).toBe('idle');
      const dropped = await observe(app, page, `${target}-dropped`);
      observations.push(dropped);
      expect(dropped.placement.placement.kind).toBe(
        target === 'left' || target === 'right' ? 'edge' : target,
      );
      if (target !== 'floating')
        expect(absoluteSurface(dropped.placement)).toEqual(absoluteSurface(candidate, true));
      expect(dropped.native.id).toBe(initial.native.id);
      expect(dropped.renderer.marker).toBe(initial.renderer.marker);
      expect(dropped.renderer.opened).toEqual([]);
      reachable(dropped.placement, dropped.native.displays);
      await artifact(page, testInfo, `${target}-drop`);
    }
    const beforeCancel = (await placement(page)).placement;
    await beginDrag(app, page);
    const token = (await placement(page)).dragToken;
    await nativePointer('escape');
    await expect.poll(async () => (await placement(page)).phase).toBe('idle');
    await page.evaluate(
      (token) =>
        window.electronAPI!.invoke('window:update-dock-placement', {
          action: 'end-drag',
          token,
          sequence: 9999,
        }),
      token,
    );
    expect((await placement(page)).placement).toEqual(beforeCancel);
    await nativePointer('up', await screenPoint(app, page));
    observations.push(await observe(app, page, 'escape-rollback-rejects-stale-drop'));
    await beginDrag(app, page);
    const invalidatedToken = (await placement(page)).dragToken;
    await app.evaluate(({ screen }) => {
      screen.emit('display-metrics-changed', {}, screen.getPrimaryDisplay(), ['workArea']);
    });
    await expect.poll(async () => (await placement(page)).phase).toBe('idle');
    await page.evaluate(
      (token) =>
        window.electronAPI!.invoke('window:update-dock-placement', {
          action: 'end-drag',
          token,
          sequence: 10000,
        }),
      invalidatedToken,
    );
    expect((await placement(page)).placement).toEqual(beforeCancel);
    observations.push(await observe(app, page, 'injected-display-event-invalidates-drag'));
  } finally {
    await nativePointer('up', { x: 100, y: 100 }).catch(() => {});
    await finish(app, page, testInfo, { ...(await provenance()), observations });
    await rm(profile, { recursive: true, force: true });
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

test('controlled fast drag: renderer startup survives cursor leaving original surface', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo);
  const observations = [];
  try {
    await app.evaluate(() => {
      const native = (globalThis as any).companionNative.native;
      return native.updateDockPlacement(native.getDockWindow(), {
        action: 'move',
        target: 'floating',
      });
    });
    await expect.poll(async () => (await placement(page)).placement.kind).toBe('floating');
    const initial = await observe(app, page, 'before-fast-drag');
    const grip = (await page.getByTestId('dock-drag-handle').boundingBox())!;
    const point = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    const surface = absoluteSurface(initial.placement);
    await app.evaluate(
      (_electron, value) => (globalThis as any).companionNative.setControlledCursor(value),
      { x: initial.native.bounds.x + point.x, y: initial.native.bounds.y + point.y },
    );
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await app.evaluate(
      (_electron, value) => (globalThis as any).companionNative.setControlledCursor(value),
      { x: surface.x + surface.width + 160, y: surface.y + 100 },
    );
    await page.mouse.move(point.x + 80, point.y + 100);
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as any).companionNative
              .snapshot()
              .calls.filter(
                (c: any) =>
                  c.boundary === 'production-placement-command' &&
                  c.command.action === 'begin-drag',
              ).length,
        ),
      )
      .toBeGreaterThan(0);
    observations.push(await observe(app, page, 'after-fast-start-request'));
    await expect
      .poll(async () => (await placement(page)).phase, { timeout: 1500 })
      .toBe('dragging');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(async () => (await placement(page)).phase).toBe('idle');
    expect((await placement(page)).placement).toEqual(initial.placement.placement);
    expect(await app.evaluate(() => (globalThis as any).companionNative.menu.isEnabled())).toBe(
      true,
    );
    observations.push(await observe(app, page, 'escape-rolls-back-without-dismissal'));
  } finally {
    await page.mouse.up().catch(() => {});
    const bridgeDiagnostic = !(await app.evaluate(() =>
      (globalThis as any).companionNative
        .snapshot()
        .calls.some(
          (entry: any) =>
            entry.boundary === 'production-placement-command' &&
            entry.command.action === 'begin-drag',
        ),
    ))
      ? await page
          .evaluate(() => (window as any).companionFixture.diagnoseLastBeginBridge())
          .catch(String)
      : null;
    await finish(app, page, testInfo, {
      ...(await provenance()),
      rendererSynthesizedInput: true,
      controlledOSCursor: true,
      finalObservation: await observe(app, page, 'fast-drag-final').catch(() => null),
      bridgeDiagnostic,
      observations,
    });
    await rm(profile, { recursive: true, force: true });
  }
});

for (const geometryFixture of ['notch', 'none'] as const) {
  test(`controlled snap morph: ${geometryFixture} target metadata, layers and bounded envelopes survive commit`, async ({}, testInfo) => {
    const geometry = [];
    for (const forwarding of [true, false]) {
      const display = {
        id: 1,
        bounds: { x: -1920, y: -1080, width: 1920, height: 1080 },
        workArea: { x: -1920, y: -1048, width: 1920, height: 1000 },
        cutout: null,
      };
      for (const side of ['left', 'right'] as const) {
        const target = resolveDockSurface(
          { kind: 'edge', displayId: 1, side, along: 0.5 },
          display,
          {
            width: 40,
            height: 240,
          },
        );
        const bounds = dockWindowEnvelope(target, display, null, side, forwarding);
        expect(bounds.x).toBeGreaterThanOrEqual(display.bounds.x);
        expect(bounds.y).toBeGreaterThanOrEqual(display.bounds.y);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(
          display.bounds.x + display.bounds.width,
        );
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(
          display.bounds.y + display.bounds.height,
        );
        if (!forwarding) expect(bounds).toEqual(target);
        geometry.push({
          name: `negative-origin-${side}-${forwarding ? 'forwarding' : 'nonforwarding'}`,
          target,
          bounds,
        });
      }
    }
    const { app, page, profile } = await launch(testInfo, undefined, geometryFixture);
    const observations: unknown[] = [];
    try {
      const results = await app.evaluate(async ({ screen }) => {
        const fixture = (globalThis as any).companionNative;
        const native = fixture.native;
        const window = native.getDockWindow();
        const layerTimeline: any[] = [];
        let stage = 'setup';
        const originalLevel = window.setAlwaysOnTop;
        const originalBounds = window.setBounds;
        const originalSend = window.webContents.send;
        window.setAlwaysOnTop = (...args: any[]) => {
          layerTimeline.push({ kind: 'level', stage, enabled: args[0], level: args[1] });
          return originalLevel.apply(window, args);
        };
        window.setBounds = (...args: any[]) => {
          layerTimeline.push({ kind: 'bounds', stage });
          return originalBounds.apply(window, args);
        };
        window.webContents.send = (channel: string, ...args: any[]) => {
          if (args[0]?.surface)
            layerTimeline.push({
              kind: 'snapshot',
              stage,
              shape: args[0].shape,
              target: args[0].dragTarget?.shape,
            });
          return originalSend.call(window.webContents, channel, ...args);
        };
        try {
          const current = () => native.getDockPlacementSnapshot(window);
          const command = (value: unknown) => native.updateDockPlacement(window, value);
          const begin = async () => {
            const before = current();
            const anchor = before.floatingAnchor ?? before.surface;
            fixture.setControlledCursor({
              x: before.windowBounds.x + anchor.x + 20,
              y: before.windowBounds.y + anchor.y + 20,
            });
            await command({
              action: 'begin-drag',
              revision: before.revision,
              origin: { x: anchor.x - before.surface.x + 20, y: anchor.y - before.surface.y + 20 },
            });
            return current().dragToken;
          };
          const rows = [];
          for (const name of ['left', 'right', 'notch']) {
            stage = `${name}-setup`;
            await command({ action: 'move', target: 'notch' });
            const hardware = current();
            const display = screen
              .getAllDisplays()
              .find((entry) => entry.id === hardware.displayId)!;
            const area = display.workArea;
            const point =
              name === 'notch'
                ? {
                    x: hardware.windowBounds.x + hardware.surface.x + hardware.surface.width / 2,
                    y: display.bounds.y + 2,
                  }
                : {
                    x: name === 'left' ? area.x + 2 : area.x + area.width - 2,
                    y: area.y + area.height / 2,
                  };
            await command({ action: 'move', target: 'floating' });
            const token = await begin();
            // Moving to floating can retain a compact anchor in the notch zone.
            // Establish a genuinely free drag before measuring acquisition.
            stage = `${name}-free-precondition`;
            fixture.setControlledCursor({
              x: area.x + area.width / 2,
              y: area.y + area.height / 2,
            });
            await command({ action: 'drag', token, sequence: 1 });
            const freeBeforeAcquire = current();
            stage = `${name}-acquire`;
            fixture.setControlledCursor(point);
            await command({ action: 'drag', token, sequence: 2 });
            stage = `${name}-same-candidate`;
            point.y += 1;
            fixture.setControlledCursor(point);
            await command({ action: 'drag', token, sequence: 3 });
            const held = current();
            const transitions: any[] = [];
            const setBounds = window.setBounds;
            const send = window.webContents.send;
            window.setBounds = (...args: any[]) => {
              const before = window.getBounds();
              const result = setBounds.apply(window, args);
              transitions.push({ kind: 'bounds', before, after: window.getBounds() });
              return result;
            };
            window.webContents.send = (channel: string, ...args: any[]) => {
              if (args[0]?.surface)
                transitions.push({
                  kind: 'snapshot',
                  bounds: window.getBounds(),
                  snapshot: args[0],
                });
              return send.call(window.webContents, channel, ...args);
            };
            let committed;
            let persistence;
            try {
              stage = `${name}-commit`;
              persistence = command({
                action: 'end-drag',
                token,
                sequence: 4,
                releasePoint: point,
              });
              committed = current();
            } finally {
              window.setBounds = setBounds;
              window.webContents.send = send;
            }
            await persistence;
            stage = `${name}-ack`;
            await command({
              action: 'resize',
              revision: current().revision,
              width: committed.surface.width,
              height: committed.surface.height,
            });
            const acknowledged = current();
            window.emit('blur');
            const blurred = current();
            stage = `${name}-detach`;
            const cancelToken = await begin();
            fixture.setControlledCursor({
              x: area.x + area.width / 2,
              y: area.y + area.height / 2,
            });
            await command({ action: 'drag', token: cancelToken, sequence: 1 });
            const detached = current();
            stage = `${name}-cancel`;
            await command({ action: 'cancel-drag', token: cancelToken, sequence: 2 });
            const cancelled = current();
            stage = `${name}-capture`;
            native.setDockHiddenForCapture(true);
            const hidden = current();
            native.setDockHiddenForCapture(false);
            const restored = current();
            stage = `${name}-reset`;
            await command({ action: 'move', target: name });
            const reset = current();
            rows.push({
              name,
              hardware,
              freeBeforeAcquire,
              held,
              transitions,
              committed,
              acknowledged,
              blurred,
              detached,
              cancelled,
              hidden,
              restored,
              reset,
            });
          }
          stage = 'reversal-setup';
          await command({ action: 'move', target: 'floating' });
          const token = await begin();
          const display = screen
            .getAllDisplays()
            .find((entry) => entry.id === current().displayId)!;
          const y = display.workArea.y + display.workArea.height / 2;
          stage = 'reversal-free-precondition';
          fixture.setControlledCursor({ x: display.workArea.x + display.workArea.width / 2, y });
          await command({ action: 'drag', token, sequence: 1 });
          const freeBeforeReversal = current();
          stage = 'reversal-notch';
          fixture.setControlledCursor({
            x: display.bounds.x + display.bounds.width / 2,
            y: display.bounds.y + 2,
          });
          await command({ action: 'drag', token, sequence: 2 });
          stage = 'reversal-left';
          fixture.setControlledCursor({ x: display.workArea.x + 2, y });
          await command({ action: 'drag', token, sequence: 3 });
          const left = current();
          stage = 'reversal-right';
          fixture.setControlledCursor({ x: display.workArea.x + display.workArea.width - 2, y });
          await command({ action: 'drag', token, sequence: 4 });
          const right = current();
          stage = 'reversal-free';
          fixture.setControlledCursor({ x: display.workArea.x + display.workArea.width / 2, y });
          await command({ action: 'drag', token, sequence: 5 });
          const free = current();
          stage = 'display-change';
          screen.emit('display-metrics-changed', {}, display, ['workArea']);
          return {
            rows,
            reversal: { freeBeforeReversal, left, right, free },
            displayToken: token,
            layerTimeline,
          };
        } finally {
          window.setAlwaysOnTop = originalLevel;
          window.setBounds = originalBounds;
          window.webContents.send = originalSend;
        }
      });
      observations.push(results);
      const notchLevel =
        geometryFixture === 'notch' && process.platform === 'darwin' ? 'status' : 'floating';
      const events = (stage: string) =>
        results.layerTimeline.filter((entry: any) => entry.stage === stage);
      const levels = (stage: string) =>
        events(stage)
          .filter((entry: any) => entry.kind === 'level')
          .map((entry: any) => entry.level);
      expect(levels('notch-acquire')).toEqual(notchLevel === 'status' ? ['status'] : []);
      if (notchLevel === 'status') {
        for (const stage of ['notch-acquire', 'notch-cancel', 'reversal-notch', 'reversal-left']) {
          const timeline = events(stage);
          expect(timeline[0].kind, stage).toBe('level');
          expect(
            timeline.findIndex((entry: any) => entry.kind === 'bounds'),
            stage,
          ).toBeGreaterThan(0);
          expect(
            timeline.findIndex((entry: any) => entry.kind === 'snapshot'),
            stage,
          ).toBeGreaterThan(0);
        }
      } else {
        expect(results.layerTimeline.filter((entry: any) => entry.kind === 'level')).toEqual([]);
      }
      expect(levels('notch-detach')).toEqual(notchLevel === 'status' ? ['floating'] : []);
      expect(levels('notch-cancel')).toEqual(notchLevel === 'status' ? ['status'] : []);
      expect(levels('reversal-notch')).toEqual(notchLevel === 'status' ? ['status'] : []);
      expect(levels('reversal-left')).toEqual(notchLevel === 'status' ? ['floating'] : []);
      expect(levels('reversal-right')).toEqual([]);
      expect(levels('reversal-free')).toEqual([]);
      expect(results.reversal.freeBeforeReversal.phase).toBe('dragging');
      expect(results.reversal.freeBeforeReversal.dragTarget).toBeNull();
      for (const row of results.rows) {
        expect(row.freeBeforeAcquire.phase, row.name).toBe('dragging');
        expect(row.freeBeforeAcquire.dragTarget, row.name).toBeNull();
        const target = row.held.dragTarget;
        expect(target, row.name).not.toBeNull();
        expect(target.surface, row.name).toEqual(row.held.snapPreview);
        for (const phase of ['same-candidate', 'commit', 'ack', 'capture'])
          expect(levels(`${row.name}-${phase}`), `${row.name}-${phase}`).toEqual([]);
        expect(target.shape, row.name).toBe(
          row.name === 'notch' ? (geometryFixture === 'notch' ? 'notch' : 'top-pill') : 'edge',
        );
        if (row.name !== 'notch') {
          expect(target.placement.side).toBe(row.name);
          expect(target.cutout).toBeNull();
        } else if (geometryFixture === 'notch') {
          expect(target.cutout).not.toBeNull();
          expect(row.held.windowBounds.x + target.cutout.x).toBe(
            row.hardware.windowBounds.x + row.hardware.cutout.x,
          );
        } else expect(target.cutout).toBeNull();
        expect(row.committed.dragTarget).toBeNull();
        expect(row.committed.windowBounds, row.name).toEqual(row.held.windowBounds);
        expect(row.committed.surface, row.name).toEqual(target.surface);
        const bounds = row.transitions.filter((entry: any) => entry.kind === 'bounds');
        expect(bounds).toHaveLength(1);
        expect(bounds[0].after).toEqual(bounds[0].before);
        const oldPaint = {
          x: bounds[0].after.x + target.surface.x,
          y: bounds[0].after.y + target.surface.y,
        };
        expect(oldPaint).toEqual({
          x: bounds[0].before.x + target.surface.x,
          y: bounds[0].before.y + target.surface.y,
        });
        expect(
          row.transitions
            .filter((entry: any) => entry.kind === 'snapshot')
            .map((entry: any) => entry.snapshot.phase),
        ).toEqual(['idle']);
        expect(row.acknowledged.windowBounds).toEqual(row.committed.windowBounds);
        expect(row.blurred.windowBounds).toEqual(row.committed.windowBounds);
        expect(row.detached.dragTarget).toBeNull();
        expect(row.cancelled.windowBounds).toEqual(row.committed.windowBounds);
        expect(row.cancelled.placement).toEqual(row.committed.placement);
        expect(row.hidden.captureHidden).toBe(true);
        expect(row.hidden.dragTarget).toBeNull();
        // Explicit move and capture cleanup both discard the retained floor.
        expect(row.restored.windowBounds).toEqual(row.reset.windowBounds);
      }
      expect(results.reversal.left.dragTarget.placement.side).toBe('left');
      expect(results.reversal.right.dragTarget.placement.side).toBe('right');
      expect(results.reversal.right.windowBounds.x).toBeGreaterThan(
        results.reversal.left.windowBounds.x,
      );
      expect(results.reversal.free.dragTarget).toBeNull();
      expect(results.reversal.free.windowBounds.width).toBeLessThanOrEqual(
        224 + 2 * DOCK_FLOATING_SHADOW_MARGIN,
      );
      await expect.poll(async () => (await placement(page)).phase).toBe('idle');
      expect((await placement(page)).dragTarget).toBeNull();
    } finally {
      await finish(app, page, testInfo, {
        ...(await provenance()),
        directTrackedNativeCommands: true,
        controlledCursor: true,
        geometry,
        geometryFixture,
        observations,
      });
      await rm(profile, { recursive: true, force: true });
    }
  });
}

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

test('native cursor diagnostic: expanded notch header and routing boundaries', async ({}, testInfo) => {
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
    const shell = page.getByTestId('dock-shell');
    await page.getByTestId('dock-drag-handle').focus();
    await expect(shell).toHaveAttribute('data-expanded', 'true');
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await expect(page.getByTestId('dock-overview')).toBeVisible();

    const sample = async (name: 'logo' | 'wing' | 'control' | 'margin', focus: string) => {
      const local = await page.evaluate((name) => {
        const header = document.querySelector('.companion-header')!;
        const box = header.getBoundingClientRect();
        if (name === 'margin') return { x: 2, y: innerHeight - 2 };
        if (name === 'wing') {
          const camera = document
            .querySelector('[data-testid="dock-camera-exclusion"]')!
            .getBoundingClientRect();
          const y = box.y + box.height / 2;
          for (let x = box.x + 4; x < box.right - 4; x += 2) {
            if (x >= camera.x && x <= camera.right) continue;
            if (document.elementFromPoint(x, y) === header) return { x, y };
          }
          throw new Error('No exposed camera-safe blank header point');
        }
        const element =
          name === 'logo'
            ? document.querySelector('[data-testid="dock-drag-handle"] svg')
            : document.querySelector('[data-dock-row]');
        if (!element) throw new Error(`Missing diagnostic target: ${name}`);
        const rect = element.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, name);
      const label = `${focus}-${name}`;
      await app.evaluate(
        (_electron, { label, local }) => {
          const fixture = (globalThis as any).companionNative;
          fixture.cursorDiagnostic.stage = label;
          const bounds = fixture.native.getDockWindow().getBounds();
          fixture.setControlledCursor({ x: bounds.x + local.x, y: bounds.y + local.y });
        },
        { label, local },
      );
      // Chromium input exercises the renderer cursor request; the controlled native
      // cursor drives production routing. Neither posts physical OS pointer input.
      await page.mouse.move(local.x, local.y);
      await expect
        .poll(async () =>
          app.evaluate(() => {
            const fixture = (globalThis as any).companionNative;
            return fixture.snapshot().ignoredPointerInput?.ignore;
          }),
        )
        .toBe(name === 'margin');
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      // A second small move after routing settles distinguishes entry forwarding
      // from ordinary interactive-window cursor dispatch without waiting on time.
      await page.mouse.move(local.x + 0.25, local.y);
      const dom = await page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        const style = element ? getComputedStyle(element) : null;
        const ancestors = [];
        for (let node = element; node; node = node.parentElement) {
          const css = getComputedStyle(node);
          ancestors.push({
            tag: node.tagName,
            id: node.id,
            className: node.getAttribute('class'),
            cursor: css.cursor,
            appRegion: css.getPropertyValue('-webkit-app-region'),
          });
        }
        return {
          point: { x, y },
          tag: element?.tagName,
          testId: element?.closest('[data-testid]')?.getAttribute('data-testid'),
          cursor: style?.cursor,
          appRegion: style?.getPropertyValue('-webkit-app-region'),
          ancestors,
          header: Boolean(element?.closest('.companion-header')),
          grip: Boolean(element?.closest('[data-testid="dock-drag-handle"]')),
          focused: document.hasFocus(),
          expanded: document
            .querySelector('[data-testid="dock-shell"]')
            ?.getAttribute('data-expanded'),
        };
      }, local);
      const native = await app.evaluate(() => {
        const fixture = (globalThis as any).companionNative;
        const state = fixture.snapshot();
        const payload = state.pointerRouting?.payload;
        const local = { x: state.cursor.x - state.bounds.x, y: state.cursor.y - state.bounds.y };
        return {
          bounds: state.bounds,
          placement: state.placement,
          focused: state.focused,
          routing: state.pointerRouting,
          ignored: state.ignoredPointerInput,
          containsPoint: Boolean(
            payload?.active &&
            payload.regions.some(
              (r: any) =>
                local.x >= r.x &&
                local.x < r.x + r.width &&
                local.y >= r.y &&
                local.y < r.y + r.height,
            ),
          ),
          lastCursor: fixture.cursorDiagnostic.lastCursor,
          events: fixture.cursorDiagnostic.events.filter(
            (event: any) => event.stage === fixture.cursorDiagnostic.stage,
          ),
        };
      });
      const repeated = await app.evaluate(() => {
        const fixture = (globalThis as any).companionNative;
        const diagnostic = fixture.cursorDiagnostic;
        const state = fixture.snapshot();
        const start = diagnostic.events.length;
        const accepted = Array.from({ length: 5 }, () =>
          fixture.native.setDockPointerRegions(
            fixture.native.getDockWindow(),
            state.pointerRouting.payload,
          ),
        );
        return {
          accepted,
          writes: diagnostic.events.slice(start).filter((event: any) => event.kind === 'ignore'),
        };
      });
      observations.push({ label, name, dom, native, repeated });
    };
    for (const name of ['control', 'logo', 'wing', 'margin'] as const)
      await sample(name, 'focused');
    // Restore header presence before focus changes, so leaving the window does
    // not conflate passive collapse with an unfocused cursor request.
    await app.evaluate(() => (globalThis as any).companionNative.native.focusDockWindow());
    await page.getByTestId('dock-drag-handle').focus();
    await expect(shell).toHaveAttribute('data-expanded', 'true');
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await sample('logo', 'before-blur');
    await app.evaluate(() => (globalThis as any).companionNative.openFocusTarget());
    await expect
      .poll(async () => app.evaluate(() => (globalThis as any).companionNative.snapshot().focused))
      .toBe(false);
    if ((await shell.getAttribute('data-expanded')) === 'true') {
      for (const name of ['control', 'logo', 'wing'] as const) await sample(name, 'unfocused');
    } else
      observations.push({
        label: 'unfocused-checkpoint',
        skipped:
          'Normal blur collapsed expanded header; no synthetic reopening or focus policy override.',
      });
    await artifact(page, testInfo, 'expanded-notch-cursor-diagnostic');
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
      const rows = [];
      diagnostic.stage = 'controlled-synchronous-cursor-handoff';
      route(true);
      const initial = snapshot();
      const accepted = { active: true, regions: [initial.surface], revision: initial.revision };
      const marginPoint = { x: initial.windowBounds.x - 1, y: initial.windowBounds.y - 1 };
      fixture.setControlledCursor(marginPoint);
      native.setDockPointerRegions(window, accepted);
      const beforeHandoff = fixture.snapshot().ignoredPointerInput;
      const startHandoff = count();
      fixture.setControlledCursor({
        x: initial.windowBounds.x + initial.surface.x + 20,
        y: initial.windowBounds.y + initial.surface.y + 20,
      });
      // No await or timer yield: only the production event listener can update
      // routing here. The actual Chromium cursor observations remain separate.
      window.webContents.emit('cursor-changed', {}, 'grab');
      const insideHandoff = fixture.snapshot().ignoredPointerInput;
      const insideWrites = count() - startHandoff;
      fixture.setControlledCursor(marginPoint);
      window.webContents.emit('cursor-changed', {}, 'pointer');
      const outsideHandoff = fixture.snapshot().ignoredPointerInput;
      const beforeRepeatedOutside = count();
      for (let i = 0; i < 5; i++) window.webContents.emit('cursor-changed', {}, 'pointer');
      const synchronousHandoff = {
        controlledEvent: true,
        noMainTurnYield: true,
        beforeHandoff,
        insideHandoff,
        insideWrites,
        outsideHandoff,
        repeatedOutsideWrites: count() - beforeRepeatedOutside,
      };
      diagnostic.stage = 'routing-stale';
      route(true);
      const beforeStale = count();
      const staleAccepted = route(false, snapshot().revision - 1);
      const stale = {
        accepted: staleAccepted,
        writes: count() - beforeStale,
        ignored: fixture.snapshot().ignoredPointerInput,
      };
      for (const kind of ['drag', 'resize']) {
        diagnostic.stage = `routing-${kind}`;
        route(false);
        const initial = snapshot();
        await native.updateDockPlacement(
          window,
          kind === 'drag'
            ? { action: 'begin-drag', revision: initial.revision, origin: { x: 20, y: 20 } }
            : {
                action: 'begin-resize',
                revision: initial.revision,
                origin: { x: initial.surface.x + 20, y: initial.surface.y + 20 },
              },
        );
        const active = snapshot();
        const token = kind === 'drag' ? active.dragToken : active.resizeToken;
        const beforeRepeat = count();
        for (let i = 0; i < 5; i++) route(false);
        const held = {
          token,
          ignored: fixture.snapshot().ignoredPointerInput,
          repeatedWrites: count() - beforeRepeat,
        };
        await native.updateDockPlacement(window, {
          action: `cancel-${kind}`,
          token,
          ...(kind === 'drag' ? { sequence: 1 } : {}),
        });
        rows.push({
          kind,
          held,
          cancelled: snapshot(),
          ignoredAfterCancel: fixture.snapshot().ignoredPointerInput,
        });
      }
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
      return { synchronousHandoff, stale, rows, errors };
    });
    observations.push({ label: 'routing-lifecycle', routingLifecycle });
    // Keep all checkpoints in the artifact even if a requested cursor is missing.
    for (const row of observations.filter((entry) => entry.native)) {
      expect(row.repeated.accepted, row.label).toEqual([true, true, true, true, true]);
      expect(
        row.repeated.writes,
        `${row.label}: unchanged routing does not rewrite native state`,
      ).toEqual([]);
      expect(row.native.routing.result.supported, row.label).toBe(true);
      expect(row.native.routing.payload.revision, row.label).toBe(row.native.placement.revision);
      expect(row.native.containsPoint, row.label).toBe(row.name !== 'margin');
      expect(row.native.ignored.ignore, row.label).toBe(row.name === 'margin');
      if (row.name === 'logo' || row.name === 'wing') {
        expect(row.dom.header, row.label).toBe(true);
        expect(row.dom.cursor, row.label).toBe('grab');
        expect(
          row.dom.ancestors.some((entry: any) => entry.appRegion === 'drag'),
          row.label,
        ).toBe(false);
        expect(row.native.lastCursor, row.label).toBe('grab');
      } else if (row.name === 'control') {
        expect(row.dom.cursor, row.label).toBe('pointer');
        expect(row.native.lastCursor, row.label).toBe('hand');
      }
      if (row.label.startsWith('unfocused-')) expect(row.native.focused, row.label).toBe(false);
    }
    const entry = observations.find((row) => row.label === 'before-blur-logo');
    const firstGrab = entry.native.events.find(
      (event: any) => event.kind === 'cursor' && event.type === 'grab',
    );
    expect(firstGrab, 'transparent margin to header must emit grab').toBeDefined();
    expect(firstGrab.routing.payload.revision).toBe(firstGrab.revision);
    expect(firstGrab.routing.result.supported).toBe(true);
    expect(
      firstGrab.ignored.ignore,
      'routing is interactive at the cursor request, before the next poll',
    ).toBe(false);
    const point = {
      x: firstGrab.point.x - firstGrab.bounds.x,
      y: firstGrab.point.y - firstGrab.bounds.y,
    };
    expect(
      firstGrab.routing.payload.regions.some(
        (r: any) =>
          point.x >= r.x && point.x < r.x + r.width && point.y >= r.y && point.y < r.y + r.height,
      ),
    ).toBe(true);
    const margin = observations.find((row) => row.label === 'focused-margin');
    expect(
      margin.native.events
        .filter((event: any) => event.kind === 'ignore')
        .map((event: any) => ({ ignore: event.ignore, forward: event.options?.forward })),
    ).toEqual([{ ignore: true, forward: true }]);
    expect(
      entry.native.events
        .filter((event: any) => event.kind === 'ignore')
        .map((event: any) => event.ignore),
    ).toEqual([false]);
    expect(routingLifecycle.synchronousHandoff).toMatchObject({
      controlledEvent: true,
      noMainTurnYield: true,
      beforeHandoff: { ignore: true, options: { forward: true } },
      insideHandoff: { ignore: false },
      insideWrites: 1,
      outsideHandoff: { ignore: true, options: { forward: true } },
      repeatedOutsideWrites: 0,
    });
    expect(routingLifecycle.stale).toMatchObject({
      accepted: false,
      writes: 0,
      ignored: { ignore: false },
    });
    for (const row of routingLifecycle.rows) {
      expect(row.held.token, row.kind).toBeTruthy();
      expect(row.held).toMatchObject({ ignored: { ignore: false }, repeatedWrites: 0 });
      expect(row.cancelled.dragToken).toBeNull();
      expect(row.cancelled.resizeToken).toBeNull();
      expect(row.ignoredAfterCancel).toMatchObject({ ignore: true, options: { forward: true } });
    }
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
      chromiumPointerInput: true,
      physicalPointerInput: false,
      physicalCursorAppearanceProven: false,
      observations,
      timeline,
    });
    await rm(profile, { recursive: true, force: true });
  }
});

test('controlled right-edge release: later cursor movement cannot change the committed drop', async ({}, testInfo) => {
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
  const { app, page, profile } = await launch(testInfo);
  const observations = [];
  try {
    const result = await app.evaluate(async ({ screen }) => {
      const fixture = (globalThis as any).companionNative;
      const native = fixture.native;
      const window = native.getDockWindow();
      const transitions: any[] = [];
      let stage = 'setup';
      const setBounds = window.setBounds;
      const send = window.webContents.send;
      window.setBounds = (...args: any[]) => {
        const before = window.getBounds();
        const result = setBounds.apply(window, args);
        transitions.push({
          kind: 'bounds',
          stage,
          before,
          requested: args[0],
          after: window.getBounds(),
        });
        return result;
      };
      window.webContents.send = (channel: string, ...args: any[]) => {
        if (args[0]?.surface && args[0]?.windowBounds)
          transitions.push({
            kind: 'snapshot',
            stage,
            channel,
            bounds: window.getBounds(),
            snapshot: args[0],
          });
        return send.call(window.webContents, channel, ...args);
      };
      const command = (value: unknown) => native.updateDockPlacement(window, value);
      const current = () => native.getDockPlacementSnapshot(window);
      const commit = async (label: string, value: unknown) => {
        stage = label;
        const persistence = command(value);
        const snapshot = current();
        // Separate the synchronous native commit from later renderer resize requests
        // while preference persistence yields; retain both in the raw timeline.
        stage = `${label}-persist`;
        await persistence;
        return snapshot;
      };
      try {
        await command({ action: 'move', target: 'right' });
        const before = current();
        const area = screen
          .getAllDisplays()
          .find((display) => display.id === before.displayId)!.workArea;
        const releasePoint = {
          x: area.x + Math.round(area.width / 2),
          y: area.y + Math.round(area.height / 2),
        };
        const begin = async () => {
          const snapshot = current();
          fixture.setControlledCursor({
            x: snapshot.windowBounds.x + snapshot.surface.x + 20,
            y: snapshot.windowBounds.y + snapshot.surface.y + 20,
          });
          await command({
            action: 'begin-drag',
            revision: snapshot.revision,
            origin: { x: 20, y: 20 },
          });
          return current().dragToken;
        };
        const dragToken = await begin();
        fixture.setControlledCursor(releasePoint);
        await command({ action: 'drag', token: dragToken, sequence: 1 });
        const released = current();
        // Only the external cursor boundary moves after release; no OS input is posted.
        fixture.setControlledCursor({ x: area.x + area.width - 1, y: releasePoint.y });
        await command({ action: 'end-drag', token: 'stale-token', sequence: 2, releasePoint });
        const rejected = current();
        const committed = await commit('center-release', {
          action: 'end-drag',
          token: dragToken,
          sequence: 2,
          releasePoint,
        });
        stage = 'late-release';
        await command({
          action: 'end-drag',
          token: dragToken,
          sequence: 3,
          releasePoint: { x: area.x, y: area.y },
        });
        const late = current();
        stage = 'cancel';
        await command({ action: 'move', target: 'right' });
        const restored = current();
        const cancelledToken = await begin();
        await command({ action: 'cancel-drag', token: cancelledToken, sequence: 1 });
        await command({ action: 'end-drag', token: cancelledToken, sequence: 2, releasePoint });
        const cancelled = current();
        const additional = [];
        for (const name of ['right-clamped', 'unsampled-endpoint']) {
          stage = `${name}-setup`;
          await command({ action: 'move', target: 'right' });
          const token = await begin();
          // Stay outside the 48px snap hysteresis while allowing the wide core to clamp.
          const point =
            name === 'right-clamped'
              ? { x: area.x + area.width - 100, y: releasePoint.y }
              : releasePoint;
          fixture.setControlledCursor({
            x: point.x - (name === 'unsampled-endpoint' ? 30 : 0),
            y: point.y,
          });
          await command({ action: 'drag', token, sequence: 1 });
          const lastDrag = current();
          fixture.setControlledCursor({ x: area.x + area.width - 1, y: point.y });
          const committed = await commit(`${name}-release`, {
            action: 'end-drag',
            token,
            sequence: 2,
            releasePoint: point,
          });
          additional.push({ name, point, lastDrag, committed });
        }
        return {
          before,
          released,
          rejected,
          committed,
          late,
          restored,
          cancelled,
          releasePoint,
          transitions,
          additional,
        };
      } finally {
        window.setBounds = setBounds;
        window.webContents.send = send;
      }
    });
    observations.push(result);
    expect(result.released.phase).toBe('dragging');
    expect(result.released.snapPreview).toBeNull();
    expect(result.rejected).toEqual(result.released);
    expect(result.committed.placement.kind).toBe('floating');
    expect(result.committed.phase).toBe('idle');
    expect(result.committed.windowBounds).toEqual(result.released.windowBounds);
    expect(result.committed.surface).toEqual(result.released.surface);
    expect({
      x: result.committed.windowBounds.x + result.committed.floatingAnchor.x,
      y: result.committed.windowBounds.y + result.committed.floatingAnchor.y,
      width: result.committed.floatingAnchor.width,
      height: result.committed.floatingAnchor.height,
    }).toEqual(absoluteSurface(result.released));
    expect(result.late).toEqual(result.committed);
    expect(result.cancelled.placement).toEqual(result.restored.placement);
    expect(result.cancelled.phase).toBe('idle');
    for (const entry of result.additional) {
      expect(entry.committed.placement.kind, entry.name).toBe('floating');
      if (entry.name === 'right-clamped') {
        expect(entry.committed.windowBounds).toEqual(entry.lastDrag.windowBounds);
        expect(entry.committed.surface).toEqual(entry.lastDrag.surface);
      }
    }
    for (const stage of ['center-release', 'right-clamped-release', 'unsampled-endpoint-release']) {
      const transitions = result.transitions.filter((entry) => entry.stage === stage);
      expect(
        transitions.filter((entry) => entry.kind === 'bounds'),
        stage,
      ).toHaveLength(1);
      const snapshots = transitions.filter((entry) => entry.kind === 'snapshot');
      expect(snapshots, stage).toHaveLength(1);
      expect(snapshots[0].snapshot.phase, stage).toBe('idle');
      expect(snapshots[0].bounds, stage).toEqual(snapshots[0].snapshot.windowBounds);
      if (stage !== 'unsampled-endpoint-release') {
        const bounds = transitions.find((entry) => entry.kind === 'bounds');
        expect(bounds.after, stage).toEqual(bounds.before);
        const painted =
          stage === 'center-release'
            ? result.released
            : result.additional.find((entry) => entry.name === 'right-clamped')!.lastDrag;
        // Retain the last painted DOM-local core while the native origin changes,
        // before any placement event can reach the renderer. Never compensate
        // with the new snapshot's local coordinates in this prepaint oracle.
        const beforePaint = {
          ...painted.surface,
          x: bounds.before.x + painted.surface.x,
          y: bounds.before.y + painted.surface.y,
        };
        const afterBoundsBeforePaint = {
          ...painted.surface,
          x: bounds.after.x + painted.surface.x,
          y: bounds.after.y + painted.surface.y,
        };
        result.transitions.push({
          kind: 'prepaint-model',
          stage,
          paintedRevision: painted.revision,
          retainedLocalCore: painted.surface,
          beforePaint,
          afterBoundsBeforePaint,
        });
        expect(afterBoundsBeforePaint, `${stage}: old DOM with actual new native origin`).toEqual(
          beforePaint,
        );
        expect(transitions.indexOf(bounds), `${stage}: bounds precede publication`).toBeLessThan(
          transitions.indexOf(snapshots[0]),
        );
      }
    }
  } finally {
    await finish(app, page, testInfo, {
      ...(await provenance()),
      directTrackedNativeCommands: true,
      controlledCursor: true,
      geometryCases,
      observations,
    });
    await rm(profile, { recursive: true, force: true });
  }
});

test('controlled floating anchor: retained upward allocation keeps the grip and dropped compact position', async ({}, testInfo) => {
  const { app, page, profile } = await launch(testInfo);
  const observations = [];
  try {
    const result = await app.evaluate(async ({ screen }) => {
      const fixture = (globalThis as any).companionNative;
      const native = fixture.native;
      const window = native.getDockWindow();
      const command = (value: unknown) => native.updateDockPlacement(window, value);
      const current = () => native.getDockPlacementSnapshot(window);
      const absolute = (snapshot: any, key: 'surface' | 'floatingAnchor') => ({
        ...snapshot[key],
        x: snapshot.windowBounds.x + snapshot[key].x,
        y: snapshot.windowBounds.y + snapshot[key].y,
      });
      await command({ action: 'move', target: 'floating' });
      let snapshot = current();
      const area = screen
        .getAllDisplays()
        .find((display) => display.id === snapshot.displayId)!.workArea;
      let anchor = absolute(snapshot, 'floatingAnchor');
      fixture.setControlledCursor({ x: anchor.x + 48, y: anchor.y + 20 });
      await command({
        action: 'begin-drag',
        revision: snapshot.revision,
        origin: {
          x: snapshot.floatingAnchor.x - snapshot.surface.x + 48,
          y: snapshot.floatingAnchor.y - snapshot.surface.y + 20,
        },
      });
      const firstToken = current().dragToken;
      fixture.setControlledCursor({ x: area.x + area.width / 2, y: area.y + area.height - 20 });
      await command({ action: 'end-drag', token: firstToken, sequence: 1 });
      snapshot = current();
      await command({ action: 'resize', revision: snapshot.revision, width: 380, height: 320 });
      const retained = current();
      anchor = absolute(retained, 'floatingAnchor');
      fixture.setControlledCursor({ x: anchor.x + 48, y: anchor.y + 20 });
      await command({
        action: 'begin-drag',
        revision: retained.revision,
        origin: {
          x: retained.floatingAnchor.x - retained.surface.x + 48,
          y: retained.floatingAnchor.y - retained.surface.y + 20,
        },
      });
      const started = current();
      fixture.setControlledCursor({
        x: area.x + area.width - 224 + 48,
        y: area.y + Math.floor(area.height / 2),
      });
      await command({ action: 'drag', token: started.dragToken, sequence: 1 });
      const moving = current();
      await command({ action: 'end-drag', token: started.dragToken, sequence: 2 });
      const dropped = current();
      await command({ action: 'end-drag', token: started.dragToken, sequence: 3 });
      const afterLateEnd = current();
      const headerGrabs = [];
      for (const offsetX of [24, 112, 356]) {
        await command({ action: 'resize', revision: current().revision, width: 480, height: 320 });
        const before = current();
        const headerBounds = {
          x: before.surface.x,
          y: before.floatingAnchor.y,
          width: before.surface.width,
          height: before.floatingAnchor.height,
        };
        const point = {
          x: before.windowBounds.x + headerBounds.x + offsetX,
          y: before.windowBounds.y + headerBounds.y + 20,
        };
        fixture.setControlledCursor(point);
        const origin = {
          x: headerBounds.x - before.surface.x + offsetX,
          y: headerBounds.y - before.surface.y + 20,
        };
        await command({
          action: 'begin-drag',
          revision: before.revision,
          origin,
          headerBounds: { ...headerBounds, width: headerBounds.width + 20 },
        });
        const invalid = current();
        await command({ action: 'begin-drag', revision: current().revision, origin, headerBounds });
        const grabbing = current();
        headerGrabs.push({
          before,
          offsetX,
          point,
          invalid,
          grabbing,
          surface: absolute(grabbing, 'surface'),
        });
        await command({ action: 'cancel-drag', token: grabbing.dragToken, sequence: 1 });
      }
      return {
        retained,
        anchor,
        started,
        moving,
        dropped,
        afterLateEnd,
        headerGrabs,
        startedSurface: absolute(started, 'surface'),
        movingSurface: absolute(moving, 'surface'),
        droppedAnchor: absolute(dropped, 'floatingAnchor'),
      };
    });
    observations.push(result);
    expect(result.retained.expansionDirection).toBe('up');
    expect(result.retained.surface.height).toBeGreaterThan(result.anchor.height);
    expect(result.started.phase).toBe('dragging');
    expect(result.startedSurface).toEqual(result.anchor);
    expect(result.moving.snapPreview).toBeNull();
    expect(result.dropped.phase).toBe('idle');
    expect(result.droppedAnchor).toEqual(result.movingSurface);
    expect(result.droppedAnchor).toMatchObject({ width: 224, height: 40 });
    expect(result.afterLateEnd.placement).toEqual(result.dropped.placement);
    for (const grab of result.headerGrabs) {
      expect(grab.invalid.phase).toBe('idle');
      expect(grab.grabbing.phase).toBe('dragging');
      expect(grab.surface.x).toBe(grab.point.x - Math.min(216, Math.max(8, grab.offsetX)));
      expect(grab.surface.y).toBe(grab.point.y - 20);
    }
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

test('controlled conversation resize: ownership preserves pointer routing and blur rolls geometry back', async ({}, testInfo) => {
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
      await command({
        action: 'begin-resize',
        revision: current().revision,
        origin: {
          x: original.surface.x + original.surface.width - 2,
          y: original.surface.y + original.surface.height - 2,
        },
      });
      const accepted = current();
      const point = { x: accepted.windowBounds.x - 200, y: accepted.windowBounds.y - 200 };
      fixture.setControlledCursor(point);
      native.setDockPointerRegions(
        window,
        { active: false, regions: [], revision: accepted.revision },
        'darwin',
        point,
      );
      const activeRouting = fixture.snapshot().ignoredPointerInput;
      await command({ action: 'resize', revision: accepted.revision, width: 640, height: 640 });
      const missingToken = current();
      await command({
        action: 'resize',
        revision: current().revision,
        resizeToken: accepted.resizeToken,
        width: 640,
        height: 640,
        expansionDirection: original.expansionDirection,
      });
      const resized = current();
      window.emit('blur');
      const cancelled = current();
      native.setDockPointerRegions(
        window,
        { active: false, regions: [], revision: cancelled.revision },
        'darwin',
        point,
      );
      const inactiveRouting = fixture.snapshot().ignoredPointerInput;
      await command({ action: 'end-resize', token: accepted.resizeToken });
      return {
        original,
        stale,
        outside,
        accepted,
        activeRouting,
        missingToken,
        resized,
        cancelled,
        inactiveRouting,
        afterLateEnd: current(),
      };
    });
    observations.push(result);
    expect(result.stale.resizeToken).toBeNull();
    expect(result.outside.resizeToken).toBeNull();
    expect(result.accepted.resizeToken).toEqual(expect.any(String));
    expect(result.activeRouting.ignore).toBe(false);
    expect(result.missingToken.surface).toEqual(result.accepted.surface);
    expect(result.resized.floatingAnchor?.width).toBe(224);
    expect(result.resized.surface.width).toBeGreaterThanOrEqual(result.original.surface.width);
    expect(result.cancelled.resizeToken).toBeNull();
    expect(result.cancelled.surface).toEqual(result.original.surface);
    expect(result.cancelled.windowBounds).toEqual(result.original.windowBounds);
    expect(result.inactiveRouting.ignore).toBe(true);
    expect(result.afterLateEnd.surface).toEqual(result.original.surface);
    expect(result.accepted.workArea).toBeDefined();
  } finally {
    await finish(app, page, testInfo, {
      ...(await provenance()),
      directTrackedNativeCommands: true,
      controlledOSCursor: true,
      syntheticBlurEvent: true,
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

for (const finishBeforeReply of ['pointer-release', 'Escape'] as const) {
  test(`controlled late drag: ${finishBeforeReply} before native begin settles safely`, async ({}, testInfo) => {
    const { app, page, profile } = await launch(testInfo);
    const observations = [];
    try {
      await moveMenu(page, 'floating');
      const initial = await observe(app, page, 'before-delayed-begin');
      observations.push(initial);
      const grip = (await page.getByTestId('dock-drag-handle').boundingBox())!;
      const point = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
      await app.evaluate(
        (_electron, value) => {
          const fixture = (globalThis as any).companionNative;
          fixture.setControlledCursor(value);
          fixture.dragBeginGate.hold();
        },
        { x: initial.native.bounds.x + point.x, y: initial.native.bounds.y + point.y },
      );
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 20, point.y + 20);
      await expect
        .poll(() => app.evaluate(() => (globalThis as any).companionNative.dragBeginGate.pending()))
        .toBe(1);
      if (finishBeforeReply === 'Escape') await page.keyboard.press('Escape');
      else await page.mouse.up();
      await app.evaluate(() => (globalThis as any).companionNative.dragBeginGate.release());
      const finishes = (action: 'cancel-drag' | 'end-drag') =>
        app.evaluate(
          (_electron, wanted) =>
            (globalThis as any).companionNative
              .snapshot()
              .calls.filter(
                (entry: any) =>
                  entry.boundary === 'production-placement-command' &&
                  entry.command.action === wanted,
              )
              .map((entry: any) => entry.command),
          action,
        );
      if (finishBeforeReply === 'Escape') {
        // Escape abandons the drag: cancel, no drop, the placement is unchanged.
        await expect.poll(async () => (await finishes('cancel-drag')).length).toBeGreaterThan(0);
        await expect.poll(async () => (await placement(page)).phase).toBe('idle');
        expect(await finishes('end-drag')).toEqual([]);
        expect((await placement(page)).placement).toEqual(initial.placement.placement);
      } else {
        // A release while native begin is pending is a normal drop at the release point.
        await expect.poll(async () => (await finishes('end-drag')).length).toBe(1);
        const [drop] = await finishes('end-drag');
        expect(drop.releasePoint).toEqual({
          x: initial.native.bounds.x + point.x + 20,
          y: initial.native.bounds.y + point.y + 20,
        });
        expect(await finishes('cancel-drag')).toEqual([]);
        await expect.poll(async () => (await placement(page)).phase).toBe('idle');
      }
      expect(await app.evaluate(() => (globalThis as any).companionNative.menu.isEnabled())).toBe(
        true,
      );
      expect((await savedPreferences(profile)).dockPlacement.placement).toEqual(
        (await placement(page)).placement,
      );
      observations.push(await observe(app, page, 'delayed-begin-settled'));
    } finally {
      await app
        .evaluate(() => (globalThis as any).companionNative.dragBeginGate.release())
        .catch(() => {});
      await page.mouse.up().catch(() => {});
      await finish(app, page, testInfo, {
        ...(await provenance()),
        rendererSynthesizedInput: true,
        controlledOSCursor: true,
        controlledNativeBeginDelay: true,
        finalObservation: await observe(app, page, 'delayed-drag-final').catch(() => null),
        observations,
      });
      await rm(profile, { recursive: true, force: true });
    }
  });
}

test('demo: companion floating drag and dismiss with fixture data', async ({}, testInfo) => {
  test.skip(process.env.DOCK_COMPANION_DEMO !== '1', 'Opt-in paced handoff recording.');
  const { app, page, profile } = await launch(testInfo);
  const observations = [];
  try {
    await moveMenu(page, 'floating');
    await page.waitForTimeout(3000); // Deliberate demo pacing, not a readiness check.
    observations.push(await observe(app, page, 'demo-floating-start'));
    await artifact(page, testInfo, 'companion-floating');
    await page.getByTestId('dock-drag-handle').press('Shift+F10');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.waitForTimeout(2500);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.waitForTimeout(1500);

    const initial = await observe(app, page, 'demo-before-drag');
    const grip = (await page.getByTestId('dock-drag-handle').boundingBox())!;
    const point = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    const origin = { x: initial.native.bounds.x + point.x, y: initial.native.bounds.y + point.y };
    await app.evaluate(
      (_electron, value) => (globalThis as any).companionNative.setControlledCursor(value),
      origin,
    );
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 12, point.y + 12);
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).companionFixture.evidence().dragStartResult?.token),
      )
      .toBeTruthy();
    await expect.poll(async () => (await placement(page)).phase).toBe('dragging');
    const area = initial.native.displays[0].workArea;
    const destination = { x: area.x + area.width * 0.65, y: area.y + area.height * 0.45 };
    for (let step = 1; step <= 16; step++) {
      await app.evaluate(
        (_electron, value) => (globalThis as any).companionNative.setControlledCursor(value),
        {
          x: Math.round(origin.x + ((destination.x - origin.x) * step) / 16),
          y: Math.round(origin.y + ((destination.y - origin.y) * step) / 16),
        },
      );
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(1800);
    observations.push(await observe(app, page, 'demo-native-dragging'));
    await page.mouse.up();
    await expect.poll(async () => (await placement(page)).phase).toBe('idle');
    await expect(page.getByTestId('dock-overview')).toBeVisible();
    await expect
      .poll(async () => (await savedPreferences(profile)).dockPlacement.placement)
      .toEqual((await placement(page)).placement);
    expect((await placement(page)).placement).not.toEqual(initial.placement.placement);
    await page.waitForTimeout(3500);
    observations.push(await observe(app, page, 'demo-floating-drop-saved'));
    await artifact(page, testInfo, 'companion-moved');
    await page.getByTestId('dock-drag-handle').press('Shift+F10');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.waitForTimeout(2500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(await app.evaluate(() => (globalThis as any).companionNative.menu.isEnabled())).toBe(
      false,
    );
  } finally {
    await finish(app, page, testInfo, {
      ...(await provenance()),
      rendererSynthesizedInput: true,
      controlledOSCursor: true,
      demo: 'Floating companion, placement menu, drag and save, dismiss',
      observations,
    });
    await rm(profile, { recursive: true, force: true });
  }
});
