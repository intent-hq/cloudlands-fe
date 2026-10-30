import { writeFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import ComposerMediaPreview from './dock-composer-media.preview.svelte';
import ConversationWireHarness from './DockConversationWireHarness.svelte';
import AnnotationHarness from './__tests__/DockAnnotationOverlayHarness.svelte';
import { dockRailPreview, adaptiveDockFixture } from './dock-rail.preview-fixtures';
import {
  dockLocalRect,
  dockWindowEnvelope,
  resolveDockSurface,
  resolveFloatingDockGeometry,
  DOCK_FLOATING_COMPACT_SIZE,
  DOCK_FLOATING_SHADOW_MARGIN,
  type DockDisplayGeometry,
  type DockPlacementSnapshot,
} from '$shared/dock-placement';

/**
 * Motion audit: per-frame bounds of the moving surface, frame gaps, long tasks and
 * layouts forced inside animation frames (from a Chromium trace). Each motion writes
 * its stats to its Playwright output directory, attaches the JSON and keeps a video.
 * The guarded contracts: no discontinuity at the start or end of an open/close.
 */
test.use({ video: { mode: 'on', size: { width: 1000, height: 700 } } });

const PHASE = process.env.DOCK_MOTION_AUDIT_PHASE ?? 'after';

type Rect = [number, number, number, number] | null;
interface Frame {
  t: number;
  rect: Rect;
  reveal: number | null;
  opacity: number | null;
  alpha: number | null;
}

async function startSampler(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    type Sample = {
      t: number;
      rect: [number, number, number, number] | null;
      reveal: number | null;
      opacity: number | null;
      alpha: number | null;
    };
    const frames: Sample[] = [];
    const longTasks: { start: number; duration: number }[] = [];
    const sampler = { frames, longTasks, running: true };
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        sampler.longTasks.push({ start: entry.startTime, duration: entry.duration });
    });
    try {
      observer.observe({ type: 'longtask', buffered: false });
    } catch {
      // Long task timing is unavailable; frame gaps still report dropped frames.
    }
    // Read bounds after each frame has laid out, so sampling never forces layout itself.
    const tick = (t: number) => {
      if (!sampler.running) {
        observer.disconnect();
        return;
      }
      setTimeout(() => {
        const element = document.querySelector(sel);
        const box = element?.getBoundingClientRect();
        const reveal = element?.closest('[data-reveal]')?.getAttribute('data-reveal');
        sampler.frames.push({
          t,
          rect: box ? [box.x, box.y, box.width, box.height] : null,
          reveal: reveal == null ? null : Number(reveal),
          opacity: element ? Number(getComputedStyle(element).opacity) : null,
          // Background alpha: fades that animate a fill rather than opacity.
          alpha: element
            ? Number(
                getComputedStyle(element).backgroundColor.match(/[\d.]+/g)?.[3] ??
                  (getComputedStyle(element).backgroundColor.startsWith('rgba') ? 0 : 1),
              )
            : null,
        });
      }, 0);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    Object.assign(window, { __motionAudit: sampler });
  }, selector);
}

async function stopSampler(page: Page) {
  return page.evaluate(() => {
    const state = (window as any).__motionAudit;
    state.running = false;
    return { frames: state.frames as Frame[], longTasks: state.longTasks as unknown[] };
  });
}

/** Layouts that ran inside requestAnimationFrame callbacks (forced reflow in a frame). */
function layoutsInFrames(trace: Buffer): { inFrames: number; total: number; sources: string[] } {
  const events = (JSON.parse(trace.toString()).traceEvents ?? []) as {
    name: string;
    ph: string;
    ts: number;
    dur?: number;
    tid: number;
    args?: {
      beginData?: { stackTrace?: { functionName: string; url: string; lineNumber: number }[] };
    };
  }[];
  const frames = events.filter((e) => e.name === 'FireAnimationFrame' && e.ph === 'X');
  const layouts = events.filter((e) => e.name === 'Layout' && (e.ph === 'X' || e.ph === 'B'));
  const forced = layouts.filter((layout) =>
    frames.some(
      (frame) =>
        frame.tid === layout.tid &&
        layout.ts >= frame.ts &&
        layout.ts <= frame.ts + (frame.dur ?? 0),
    ),
  );
  // Where each forced layout was triggered (first app frame of its stack), most frequent first.
  const counts = new Map<string, number>();
  for (const layout of forced) {
    const stack = layout.args?.beginData?.stackTrace ?? [];
    const frame = stack.find((entry) => !entry.url.includes('node_modules')) ?? stack[0];
    const key = frame
      ? `${frame.functionName || '(anonymous)'} ${frame.url.split('/').slice(-1)[0].split('?')[0]}:${frame.lineNumber}`
      : '(no stack)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sources = [...counts].sort((a, b) => b[1] - a[1]).map(([key, n]) => `${n}x ${key}`);
  return { inFrames: forced.length, total: layouts.length, sources };
}

/** Main-thread work over 30 ms, with the script that ran it: what a long task was. */
function slowTasks(trace: Buffer): string[] {
  const events = (JSON.parse(trace.toString()).traceEvents ?? []) as {
    name: string;
    ph: string;
    dur?: number;
    args?: { data?: { functionName?: string; url?: string; type?: string } };
  }[];
  return events
    .filter(
      (e) =>
        e.ph === 'X' &&
        (e.dur ?? 0) > 30_000 &&
        [
          'FunctionCall',
          'EventDispatch',
          'TimerFire',
          'FireAnimationFrame',
          'Layout',
          'UpdateLayoutTree',
          'Paint',
          'v8.compile',
          'ParseHTML',
        ].includes(e.name),
    )
    .map((e) => {
      const data = e.args?.data;
      const where = data?.functionName || data?.type || '';
      const file = data?.url?.split('/').at(-1)?.split('?')[0] ?? '';
      return `${e.name} ${Math.round((e.dur ?? 0) / 1000)}ms ${where} ${file}`.trim();
    });
}

function summarize(frames: Frame[]) {
  const steps: number[] = [];
  const gaps: number[] = [];
  let appeared = 0;
  for (let i = 1; i < frames.length; i += 1) {
    gaps.push(frames[i].t - frames[i - 1].t);
    const a = frames[i - 1].rect;
    const b = frames[i].rect;
    if (!a || !b) {
      if (a !== b) appeared += 1;
      steps.push(0);
      continue;
    }
    steps.push(Math.max(...b.map((value, index) => Math.abs(value - a[index]))));
  }
  const moving = steps.map((step, index) => ({ step, index })).filter(({ step }) => step > 0.05);
  // Steady frames follow a normal frame gap. A step after a dropped frame legitimately
  // covers more ground (the pointer moved further, or the motion caught up on lost time),
  // so per-frame step limits judge steady frames only; load on the test host can't fail them.
  const steady = moving.filter(({ index }) => gaps[index] <= 20);
  const sorted = moving.map(({ step }) => step).sort((x, y) => x - y);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const threshold = Math.max(4, median * 3);
  const present = frames.filter((frame) => frame.rect);
  const first = present[0]?.rect;
  const last = present.at(-1)?.rect;
  const travel =
    first && last ? Math.max(...last.map((value, index) => Math.abs(value - first[index]))) : 0;
  const opacities = frames.map((frame) => frame.opacity);
  let maxOpacityStep = 0;
  for (let i = 1; i < opacities.length; i += 1) {
    const a = opacities[i - 1] ?? 0;
    const b = opacities[i] ?? 0;
    maxOpacityStep = Math.max(maxOpacityStep, Math.abs(b - a));
  }
  const widths = frames.map((frame) => frame.rect?.[2]).filter((w): w is number => w != null);
  let maxWidthStep = 0;
  for (let i = 1; i < widths.length; i += 1)
    maxWidthStep = Math.max(maxWidthStep, Math.abs(widths[i] - widths[i - 1]));
  const widthTravel = widths.length ? Math.abs(widths.at(-1)! - widths[0]) : 0;
  const fadeFrames = frames.filter(
    (frame) => frame.alpha !== null && frame.alpha > 0.02 && frame.alpha < 0.98,
  ).length;
  return {
    maxWidthStepPx: Math.round(maxWidthStep * 10) / 10,
    widthTravelPx: Math.round(widthTravel * 10) / 10,
    fadeFrames,
    maxOpacityStep: Math.round(maxOpacityStep * 100) / 100,
    travelPx: Math.round(travel * 10) / 10,
    firstReveal: present[0]?.reveal ?? null,
    frames: frames.length,
    animatedFrames: moving.length,
    maxGapMs: Math.round(Math.max(0, ...gaps) * 10) / 10,
    droppedFrames: gaps.filter((gap) => gap > 20).length,
    maxStepPx: Math.round(Math.max(0, ...steps) * 10) / 10,
    maxSteadyStepPx: Math.round(Math.max(0, ...steady.map(({ step }) => step)) * 10) / 10,
    endGapMs: Math.round((gaps[moving.at(-1)?.index ?? -1] ?? 0) * 10) / 10,
    medianStepPx: Math.round(median * 10) / 10,
    startStepPx: Math.round((moving[0]?.step ?? 0) * 10) / 10,
    endStepPx: Math.round((moving.at(-1)?.step ?? 0) * 10) / 10,
    jumps: moving.filter(({ step }) => step > threshold).length,
    appearDisappear: appeared,
  };
}

async function audit(
  page: Page,
  name: string,
  selector: string,
  run: () => Promise<void>,
): Promise<ReturnType<typeof summarize> & Record<string, unknown>> {
  const browser = page.context().browser()!;
  await startSampler(page, selector);
  await page.waitForTimeout(100);
  await browser.startTracing(page, {
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.stack',
    ],
  });
  await run();
  await page.waitForTimeout(400);
  const trace = await browser.stopTracing();
  const { frames, longTasks } = await stopSampler(page);
  const durations = (longTasks as { duration: number }[]).map((task) => task.duration);
  const stats = {
    name,
    ...summarize(frames),
    longTasks: longTasks.length,
    longTaskMaxMs: Math.round(Math.max(0, ...durations)),
    layouts: layoutsInFrames(trace),
    slowTasks: slowTasks(trace),
  };
  const info = test.info();
  const path = info.outputPath(`motion-${PHASE}-${name}.json`);
  await writeFile(path, JSON.stringify({ stats, frames }, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
  return stats;
}

type Stats = Awaited<ReturnType<typeof audit>>;

/** No snap at the end and no teleport at the start of a shell motion. */
function expectContinuous(stats: Stats): void {
  // No snap at the end, unless the last step came right after a dropped frame.
  if (stats.endGapMs <= 20) expect(stats.endStepPx, `${stats.name} end`).toBeLessThanOrEqual(2);
  if (stats.travelPx > 0 && stats.appearDisappear === 0)
    expect(stats.startStepPx / stats.travelPx, `${stats.name} start`).toBeLessThanOrEqual(0.35);
  expectNoRailReflow(stats);
}

/** The rail entries and the conversation popup owner never force a reflow in a frame. */
function expectNoRailReflow(stats: Stats): void {
  const rail = (stats.layouts as { sources: string[] }).sources.filter((source) =>
    /\b(region|revealDockItem|visiblePopupRect)\b/.test(source),
  );
  expect(rail, stats.name).toEqual([]);
}

async function settle(locator: Locator, attribute: string, value: string) {
  await expect(locator).toHaveAttribute(attribute, value, { timeout: 5000 });
}

async function mountSide(mount: (...args: any[]) => Promise<Locator>, page: Page) {
  await page.setViewportSize({ width: 1000, height: 700 });
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

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
});

const SILHOUETTE = '.shell-silhouette path';

test('motion audit: notch expand, conversation and collapse', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 680 });
  await page.mouse.move(700, 660);
  const props = dockRailPreview.states.notch.props;
  const component = await mount(DockRailPreview, {
    props: { ...props, conversationFixture: true },
  });
  const shell = component.getByTestId('dock-shell');
  const expand = await audit(page, 'notch-expand', SILHOUETTE, async () => {
    await component.getByTestId('dock-drag-handle').hover();
    await settle(shell, 'data-reveal', '1');
  });
  const conversation = await audit(page, 'notch-conversation', SILHOUETTE, async () => {
    await component.locator('[data-dock-row]').first().click();
    await expect(component.getByTestId('dock-conversation-surface')).toBeVisible();
  });
  await component
    .getByTestId('dock-conversation-surface')
    .locator('[data-dock-conversation-back]')
    .click();
  const collapse = await audit(page, 'notch-collapse', SILHOUETTE, async () => {
    await page.mouse.move(700, 660);
    await settle(shell, 'data-reveal', '0');
  });
  for (const stats of [expand, conversation, collapse]) expectContinuous(stats);
});

test('motion audit: floating open and close', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.mouse.move(980, 680);
  // A simulated display, so the preview supplies the native compact anchor like Electron.
  const display: DockDisplayGeometry = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1000, height: 700 },
    workArea: { x: 0, y: 24, width: 1000, height: 676 },
    cutout: null,
  };
  const target = { kind: 'floating' as const, displayId: 1, x: 0.5, y: 0.4 };
  const floating = resolveFloatingDockGeometry(target, display, DOCK_FLOATING_COMPACT_SIZE);
  const windowBounds = dockWindowEnvelope(
    floating.surface,
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
        ...adaptiveDockFixture('floating', 'left'),
        placement: target,
        windowBounds,
        surface: dockLocalRect(floating.surface, windowBounds),
        workArea: dockLocalRect(display.workArea, windowBounds),
        floatingAnchor: dockLocalRect(floating.anchor, windowBounds),
        expansionDirection: floating.expansionDirection,
      },
      floatingDisplay: display,
      viewportWidth: 1000,
      viewportHeight: 700,
    },
  });
  const shell = component.getByTestId('dock-shell');
  const open = await audit(page, 'floating-open', SILHOUETTE, async () => {
    await component.getByTestId('dock-drag-handle').hover();
    await settle(shell, 'data-reveal', '1');
  });
  const close = await audit(page, 'floating-close', SILHOUETTE, async () => {
    await page.mouse.move(980, 680);
    await settle(shell, 'data-reveal', '0');
  });
  for (const stats of [open, close]) expectContinuous(stats);
});

test('motion audit: edge conversation open, close and interrupted close', async ({
  mount,
  page,
}) => {
  const side = await mountSide(mount, page);
  const shellBox = side.getByTestId('dock-edge-shell');
  const SHELL = '[data-testid="dock-edge-shell"]';
  const open = await audit(page, 'edge-open', SHELL, async () => {
    await side.locator('[data-dock-entry]').first().click();
    await settle(shellBox, 'data-reveal', '1');
  });
  const close = await audit(page, 'edge-close', SHELL, async () => {
    await page.keyboard.press('Escape');
    await expect(shellBox).toHaveCount(0);
  });
  // Reverse mid-way: reopen while closing and require a continuous path.
  await side.locator('[data-dock-entry]').first().click();
  await settle(shellBox, 'data-reveal', '1');
  const interrupted = await audit(page, 'edge-interrupted', SHELL, async () => {
    await page.keyboard.press('Escape');
    await expect
      .poll(async () => Number((await shellBox.getAttribute('data-reveal')) ?? 1))
      .toBeLessThan(0.7);
    await side.locator('[data-dock-entry]').first().click();
    await settle(shellBox, 'data-reveal', '1');
  });
  for (const stats of [open, close]) expectContinuous(stats);
  // The box appears near the start of its reveal, even though mounting the panel is heavy.
  expect(open.firstReveal ?? 0, open.name).toBeLessThanOrEqual(0.35);
  // Reversing mid-way never moves further in one frame than a plain open or close.
  expect(interrupted.maxSteadyStepPx, interrupted.name).toBeLessThanOrEqual(
    Math.max(open.maxStepPx, close.maxStepPx) + 1,
  );
  expectNoRailReflow(interrupted);
});

test('motion audit: tool popover, tile removal and waveform', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await page.mouse.move(700, 500);
  const component = await mount(ComposerMediaPreview, { props: { mode: 'captured' } });
  const annotate = component.getByRole('button', { name: /^Annotate the screen\. Current tool:/ });
  const POPOVER = '.dock-media-tool-popover';
  const popoverOpen = await audit(page, 'popover-open', POPOVER, async () => {
    await annotate.hover();
    await expect(page.locator(POPOVER)).toBeVisible();
  });
  const popoverClose = await audit(page, 'popover-close', POPOVER, async () => {
    await page.mouse.move(700, 500);
    await expect(page.locator(POPOVER)).toHaveCount(0);
  });
  const tileRemove = await audit(
    page,
    'tile-remove',
    '[data-dock-media-attachments] .tile',
    async () => {
      await component.locator('[data-dock-media-attachments] .tile').first().hover();
      await component.getByRole('button', { name: 'Remove' }).first().click();
      await expect(component.locator('[data-dock-media-attachments] .tile')).toHaveCount(0);
    },
  );
  // Popover positioning (floating-ui) measures in frames by design; only report it here.
  for (const stats of [popoverOpen, popoverClose, tileRemove])
    expect(stats.frames).toBeGreaterThan(0);
  await component.unmount();
  const dictating = await mount(ComposerMediaPreview, { props: { mode: 'dictating' } });
  const waveform = await audit(page, 'waveform', '[data-dock-dictation-waveform]', async () => {
    await expect(dictating.locator('[data-dock-dictation-waveform]')).toBeVisible();
    await page.waitForTimeout(800);
  });
  expect(waveform.droppedFrames, waveform.name).toBeLessThanOrEqual(2);
});

test('motion audit: banner, question overlay and aurora', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 680 });
  const component = await mount(ConversationWireHarness, {
    props: { width: 420, height: 560, failPlacementOnce: true },
  });
  const editor = component.getByTestId('message-input').locator('[contenteditable]');
  await expect(editor).toBeEditable();
  await component.getByRole('button', { name: 'Enable Aurora preference', exact: true }).click();
  // The aurora is warmed (mounted, paused) while idle; streaming only unpauses and fades it.
  const AURORA = '.composer-aurora-host';
  await expect(component.locator(AURORA)).toHaveCount(1, { timeout: 5000 });
  const opacity = () =>
    component.locator(AURORA).evaluate((element) => Number(getComputedStyle(element).opacity));
  const auroraIn = await audit(page, 'aurora-in', AURORA, async () => {
    await component.getByRole('button', { name: 'Start synthetic stream', exact: true }).click();
    await expect.poll(opacity).toBe(1);
  });
  const auroraOut = await audit(page, 'aurora-out', AURORA, async () => {
    await component.getByRole('button', { name: 'End synthetic stream', exact: true }).click();
    await expect.poll(opacity).toBe(0);
  });
  // Starting the stream runs no long aurora work: the WebGL setup already ran while idle.
  // Attributed by script, so unrelated load on a busy test machine cannot fail it.
  expect(
    (auroraIn.slowTasks as string[]).filter(
      (task) => /AuroraBackground/.test(task) && Number(task.split(' ')[1]?.replace('ms', '')) > 50,
    ),
    auroraIn.name,
  ).toEqual([]);
  // A failed attachment placement raises the notice banner over the transcript edge.
  const NOTICE = '[data-dock-conversation-notifications] [data-dock-notice]';
  const banner = await audit(page, 'banner-enter', NOTICE, async () => {
    await editor.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['notes'], 'notes.txt', { type: 'text/plain' }));
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    });
    await expect(component.locator(NOTICE).first()).toBeVisible();
  });
  const question = await audit(page, 'question-open', '[data-dock-questions]', async () => {
    await component
      .getByRole('button', { name: 'Publish synthetic questions', exact: true })
      .click();
    await expect(component.getByTestId('question-wizard-card')).toBeVisible();
  });
  for (const stats of [auroraIn, auroraOut, banner, question]) {
    // No snap at the end, unless the last step came right after a dropped frame.
    if (stats.endGapMs <= 20) expect(stats.endStepPx, `${stats.name} end`).toBeLessThanOrEqual(2);
    expectNoRailReflow(stats);
  }
  // Fades never pop: no single frame changes opacity by more than half.
  for (const stats of [auroraIn, auroraOut, banner, question])
    expect(stats.maxOpacityStep, stats.name).toBeLessThanOrEqual(0.5);
});

test('motion audit: overview row hover', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 680 });
  await page.mouse.move(700, 660);
  const component = await mount(DockRailPreview, { props: dockRailPreview.states.notch.props });
  await component.getByTestId('dock-drag-handle').hover();
  await settle(component.getByTestId('dock-shell'), 'data-reveal', '1');
  const hover = await audit(page, 'row-hover', '.overview-row', async () => {
    await component.locator('.overview-row').nth(1).hover();
    await page.waitForTimeout(200);
    await component.locator('.overview-row').nth(2).hover();
  });
  expect(hover.droppedFrames, hover.name).toBeLessThanOrEqual(1);
  expectNoRailReflow(hover);
});

test('motion audit: record pill and capture flash', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  const component = await mount(ComposerMediaPreview, {
    props: { mode: 'captured', simulateConfirm: true },
  });
  const flash = await audit(page, 'capture-flash', '.capture-flash', async () => {
    await component.getByRole('button', { name: 'Capture the screen', exact: true }).click();
    await page.waitForTimeout(250);
  });
  const pill = await audit(page, 'record-pill', '.recording-button', async () => {
    await component.getByRole('button', { name: 'Record the screen', exact: true }).click();
    await expect(component.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  });
  for (const stats of [flash, pill]) {
    expect(stats.droppedFrames, stats.name).toBeLessThanOrEqual(1);
    expectNoRailReflow(stats);
  }
  // The pill widens over several frames, never in one jump.
  expect(pill.widthTravelPx, pill.name).toBeGreaterThan(20);
  expect(pill.maxWidthStepPx / pill.widthTravelPx, pill.name).toBeLessThanOrEqual(0.35);
  // The flash turns on at once by design, then fades out over several frames (150 ms).
  expect(flash.fadeFrames, flash.name).toBeGreaterThanOrEqual(3);
});

test('motion audit: on-screen annotate bar drag', async ({ mount, page }) => {
  await mount(AnnotationHarness, { props: { fixture: 'live-marked' } });
  const bar = page.getByTestId('dock-annotation-toolbar');
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  const drag = await audit(
    page,
    'annotate-bar-drag',
    '[data-testid="dock-annotation-toolbar"]',
    async () => {
      await page.mouse.move(box.x + 6, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 126, box.y + box.height / 2 + 60, { steps: 12 });
      await page.mouse.up();
    },
  );
  // The bar follows the pointer: no frame moves it further than the pointer moved.
  expect(drag.maxSteadyStepPx, drag.name).toBeLessThanOrEqual(Math.hypot(10, 5) * 2 + 2);
  expect(drag.droppedFrames, drag.name).toBeLessThanOrEqual(1);
});
