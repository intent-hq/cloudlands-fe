/**
 * Agent trace waterfall, end to end in a real browser.
 *
 * Drives the `agent-trace` preview scene: daemon-shaped trace records go
 * through the production builder and view, so these tests cover idle-time
 * squeezing, the span tree, keyboard access, the details card, chat jumps,
 * zoom, the live clock, and narrow-panel containment. Screenshots of each flow are
 * written to `test-results/agent-trace/` for review.
 */
import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const artifactDir = path.resolve('test-results/agent-trace');
const readyTimeout = 90_000;

test.use(existsSync(systemChrome) ? { channel: 'chrome' } : {});

let server: ViteDevServer;
let baseUrl: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  mkdirSync(artifactDir, { recursive: true });
  server = await createServer({
    cacheDir: viteHarnessCacheDir('agent-trace'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
  expect(baseUrl).not.toBe('');
});

test.afterAll(async () => {
  await server?.close();
});

async function openScene(
  page: Page,
  state: string,
  options: { width?: number; theme?: 'light' | 'dark' } = {},
) {
  const width = options.width ?? 960;
  await page.setViewportSize({ width, height: 760 });
  await page.goto(
    `${baseUrl}sandbox/agent-trace?state=${state}&theme=${options.theme ?? 'dark'}&width=${width}&motion=reduced&fit=component`,
    { waitUntil: 'domcontentloaded' },
  );
  const scene = page.getByTestId('catalog-scene');
  await expect(scene).toHaveAttribute('data-preview-ready', 'true', { timeout: readyTimeout });
  await expect(page.getByRole('tree')).toBeVisible({ timeout: readyTimeout });
  return scene;
}

const row = (page: Page, spanId: string) => page.locator(`[data-trace-row="${spanId}"]`);
const details = (page: Page) => page.locator('[data-trace-details]');
/** The chat jump the scene last asked for: `agentId messageId toolCallId`. */
const chatRequest = (page: Page) =>
  page.locator('[data-preview-chat-request]').getAttribute('data-preview-chat-request');

test('live activity keeps growing with the clock', async ({ page }) => {
  test.setTimeout(150_000);
  await openScene(page, 'live-clock');
  const duration = page.locator('[data-trace-duration]');
  const nowLine = page.locator('[data-trace-now]');
  await expect(page.locator('[data-live="true"]')).toBeVisible();

  const before = await duration.textContent();
  const leftBefore = await nowLine.evaluate((line) => line.getBoundingClientRect().left);
  await expect.poll(async () => duration.textContent(), { timeout: 10_000 }).not.toBe(before);
  await expect
    .poll(async () => nowLine.evaluate((line) => line.getBoundingClientRect().left), {
      timeout: 10_000,
    })
    .toBeGreaterThan(leftBefore);
  await page.screenshot({ path: path.join(artifactDir, 'live-clock.png') });
});

test('the tree is keyboard operable and details follow focus', async ({ page }) => {
  test.setTimeout(150_000);
  await openScene(page, 'live');
  const items = page.getByRole('treeitem');
  const lead = row(page, 'agent:agent-lead');
  const researcher = row(page, 'agent:agent-research');

  // A trace this small opens fully, so every tool call is in view.
  await expect(lead).toHaveAttribute('aria-expanded', 'true');
  await expect(researcher).toHaveAttribute('aria-expanded', 'true');
  const openCount = await items.count();

  await lead.focus();
  for (let step = 0; step < 4; step += 1) await page.keyboard.press('ArrowDown');
  await expect(researcher).toBeFocused();

  await page.keyboard.press('ArrowLeft');
  await expect(researcher).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => items.count()).toBeLessThan(openCount);
  await page.keyboard.press('ArrowRight');
  await expect(researcher).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => items.count()).toBe(openCount);
  await page.keyboard.press('ArrowLeft');
  await expect(researcher).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Enter');
  await expect(details(page)).toHaveAttribute('data-trace-details', 'agent:agent-research');
  await expect(researcher).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'agent:agent-writer')).toBeFocused();
  await expect(details(page)).toHaveAttribute('data-trace-details', 'agent:agent-writer');
  await page.screenshot({ path: path.join(artifactDir, 'keyboard-details.png') });

  await page.keyboard.press('Escape');
  await expect(details(page)).toHaveCount(0);
  await expect(row(page, 'agent:agent-writer')).toBeFocused();
});

test('a failed tool call shows its error, and clicks open and close details', async ({ page }) => {
  test.setTimeout(150_000);
  await openScene(page, 'failed-tool-details');
  const card = details(page);
  await expect(card).toBeVisible();
  await expect(card.getByRole('status')).toBeVisible();
  const failedId = await card.getAttribute('data-trace-details');
  expect(failedId).toMatch(/^tool:/);
  await expect(row(page, failedId!)).toHaveAttribute('data-status', 'failed');
  await page.screenshot({ path: path.join(artifactDir, 'failed-tool.png') });

  // Clicking another row moves the card; clicking it again keeps it there.
  const writer = row(page, 'agent:agent-writer');
  await writer.click();
  await expect(card).toHaveAttribute('data-trace-details', 'agent:agent-writer');
  await writer.click();
  await expect(card).toHaveAttribute('data-trace-details', 'agent:agent-writer');

  // A click outside the tree dismisses the card.
  await page.locator('[data-trace-duration]').click();
  await expect(details(page)).toHaveCount(0);
});

test('clicking a row asks the chat for that moment, and only rows do', async ({ page }) => {
  test.setTimeout(150_000);
  await openScene(page, 'done');
  // Fixture rows carry their role in their ids: prompts `user-msg-*`, replies `assistant-msg-*`.
  const prompt = page.locator('[data-trace-row^="turn:agent-lead"]', {
    hasText: 'Launch the new pricing page',
  });
  await prompt.click();
  await expect.poll(() => chatRequest(page)).toMatch(/^agent-lead user-msg-\d+ $/);
  await expect(prompt).toHaveAttribute('aria-selected', 'true');

  // A tool call lands on the call inside the reply that made it.
  const failedCall = page.locator('[data-trace-row^="tool:agent-coder:"][data-status="failed"]');
  const spanId = (await failedCall.getAttribute('data-trace-row'))!;
  const callId = spanId.replace(/^tool:agent-coder:/, '');
  await failedCall.click();
  await expect
    .poll(() => chatRequest(page))
    .toMatch(new RegExp(`^agent-coder assistant-msg-\\d+ ${callId}$`));
  await expect(details(page)).toHaveAttribute('data-trace-details', spanId);
  await page.screenshot({ path: path.join(artifactDir, 'chat-jump-tool.png') });

  // An agent with one turn is that turn; one with several opens at the end of its chat.
  await row(page, 'agent:agent-research').click();
  await expect.poll(() => chatRequest(page)).toMatch(/^agent-research user-msg-\d+ $/);
  await row(page, 'agent:agent-lead').click();
  await expect.poll(() => chatRequest(page)).toBe('agent-lead  ');

  // The expand arrow and arrow keys move around the tree without jumping the chat.
  const coder = row(page, 'agent:agent-coder');
  await coder.getByRole('button').click();
  await expect(coder).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowDown');
  expect(await chatRequest(page)).toBe('agent-lead  ');
  await coder.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => chatRequest(page)).toMatch(/^agent-coder user-msg-\d+ $/);
});

/** Pixels between consecutive turn bars, in time order. */
async function idleBreaks(page: Page): Promise<number[]> {
  return page.locator('[data-trace-row^="turn:"] [data-trace-bar]').evaluateAll((bars) =>
    bars.slice(1).map((bar, index) => {
      const previous = bars[index].getBoundingClientRect();
      return bar.getBoundingClientRect().left - previous.right;
    }),
  );
}

/** Widths of the turn bars, in time order. */
async function turnBarWidths(page: Page): Promise<number[]> {
  return page
    .locator('[data-trace-row^="turn:"] [data-trace-bar]')
    .evaluateAll((bars) => bars.map((bar) => bar.getBoundingClientRect().width));
}

/** Share of its timeline cell that a row's bar covers. */
async function barShare(page: Page, spanId: string): Promise<number> {
  return row(page, spanId).evaluate((item) => {
    const bar = item.querySelector('[data-trace-bar]')!.getBoundingClientRect();
    const cell = item.querySelector('[data-trace-timeline]')!.getBoundingClientRect();
    return (Math.min(bar.right, cell.right) - Math.max(bar.left, cell.left)) / cell.width;
  });
}

test('zooming fits the axis to a span, and Escape or the chip shows everything', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await openScene(page, 'done');
  const coder = row(page, 'agent:agent-coder');
  const reset = page.locator('[data-trace-zoom-reset]');
  const before = await barShare(page, 'agent:agent-coder');

  await coder.click();
  await details(page).locator('[data-trace-zoom]').click();
  await expect(reset).toBeVisible();
  await expect(details(page)).toHaveCount(0);
  await expect(coder).toHaveAttribute('aria-expanded', 'true');
  await expect(coder).toBeFocused();
  await expect.poll(() => barShare(page, 'agent:agent-coder')).toBeGreaterThan(before * 1.2);
  await page.screenshot({ path: path.join(artifactDir, 'zoomed.png') });

  await page.keyboard.press('Escape');
  await expect(reset).toHaveCount(0);
  await expect.poll(() => barShare(page, 'agent:agent-coder')).toBeCloseTo(before, 2);

  await coder.click();
  await details(page).locator('[data-trace-zoom]').click();
  await reset.click();
  await expect(reset).toHaveCount(0);
  await expect.poll(() => barShare(page, 'agent:agent-coder')).toBeCloseTo(before, 2);
});

test('the error count opens the failed call inside a collapsed agent', async ({ page }) => {
  test.setTimeout(150_000);
  await openScene(page, 'done');
  const coder = row(page, 'agent:agent-coder');
  await coder.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(coder).toHaveAttribute('aria-expanded', 'false');

  await page.locator('[data-trace-errors]').click();
  const card = details(page);
  await expect(card).toBeVisible();
  const failedId = await card.getAttribute('data-trace-details');
  expect(failedId).toMatch(/^tool:/);
  await expect(row(page, failedId!)).toBeInViewport();
  await expect(row(page, failedId!)).toHaveAttribute('data-status', 'failed');
  await expect(row(page, 'agent:agent-coder')).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: path.join(artifactDir, 'error-jump.png') });
});

test('earlier days share the timeline, each named where it starts', async ({ page }) => {
  test.setTimeout(150_000);
  await openScene(page, 'done');
  // Yesterday's turn sits on the same timeline as today's work.
  await expect(
    page.locator('[data-trace-row^="turn:"]').filter({ hasText: 'Draft the pricing brief' }),
  ).toHaveCount(1);
  // The night between yesterday's turn and today's first one shrinks to a
  // break narrower than yesterday's 9-second turn.
  const [yesterday] = await turnBarWidths(page);
  expect((await idleBreaks(page))[0]).toBeLessThan(yesterday);
  await expect(page.locator('[data-trace-day]')).toHaveCount(2);
  await page.screenshot({ path: path.join(artifactDir, 'earlier-days.png') });
});

test('a narrow panel keeps every name clear of the timeline', async ({ page }) => {
  test.setTimeout(150_000);
  const scene = await openScene(page, 'live', { width: 380 });
  const overflow = await scene.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const rows = page.getByRole('treeitem');
  const count = await rows.count();
  expect(count).toBeGreaterThan(3);
  for (let index = 0; index < count; index += 1) {
    const item = rows.nth(index);
    const nameRight = await item
      .locator('[data-trace-name]')
      .evaluate((name) => name.getBoundingClientRect().right);
    const timelineLeft = await item
      .locator('[data-trace-timeline]')
      .evaluate((cell) => cell.getBoundingClientRect().left);
    expect(nameRight).toBeLessThanOrEqual(timelineLeft + 0.5);
  }
  await page.screenshot({ path: path.join(artifactDir, 'narrow.png') });
});

test('the time axis stays above the rows while the panel scrolls', async ({ page }) => {
  test.setTimeout(150_000);
  await openScene(page, 'many-agents');
  await page.locator('[data-preview-agent-trace]').evaluate((element) => element.scrollBy(0, 400));
  const axis = page.locator('[data-trace-axis]');
  const axisOnTop = await axis.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.right - 24, box.top + box.height / 2);
    return element.contains(hit);
  });
  expect(axisOnTop).toBe(true);
});

test('a day squeezes idle time so every burst stays readable', async ({ page }) => {
  test.setTimeout(150_000);
  await openScene(page, 'day-with-gaps');
  await expect(page.locator('[data-trace-row^="turn:"]')).toHaveCount(3);
  // Two hours and 45 minutes of idle time each render narrower than the
  // 40-second wake-up turn; unsqueezed, the night would dwarf every burst.
  const breaks = await idleBreaks(page);
  expect(breaks).toHaveLength(2);
  const narrowestTurn = Math.min(...(await turnBarWidths(page)));
  for (const width of breaks) expect(width).toBeLessThan(narrowestTurn);
  await page.screenshot({ path: path.join(artifactDir, 'day-with-gaps.png') });
});
