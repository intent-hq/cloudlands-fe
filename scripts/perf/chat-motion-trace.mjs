#!/usr/bin/env node

// Chat-motion perf trace harness. Drives Playwright Chromium against a running app
// sandbox, records a CDP trace around the footer (event subscriptions) collapse/expand,
// then samples scroll geometry per animation frame: pinned toggles, a scrolled-up
// no-toggle control after a hydration-quiescence wait, and scrolled-up toggles.
// Prerequisites: `make dev-sandbox-app` (or `dev-sandbox-stack`) is healthy and `--url`
// is a workspace page whose transcript is long enough to scroll. `--out` must not exist.
// Example:
//   pnpm perf:chat-motion --url http://127.0.0.1:8264/workspace/<id> --out .demo-artifacts/perf/footer-1
// Writes trace.json, summary.json, samples.json and screenshots into --out and prints the
// summary JSON. Exit 0 on success, 1 on runtime failure, 2 for usage / refused overwrite.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { SCENARIOS, parseArgs, prepareOutDir, summarize } from './chat-motion-lib.mjs';

const USAGE =
  'usage: pnpm perf:chat-motion --url <app-url> --out <dir> [--scenario footer|context-well] [--inflate 10000] [--frames 40] [--scroll-up 800] [--quiet-ms 750] [--quiet-timeout 15000] [--timeout 180000] [--headed]';
const VIEWPORT_SELECTOR = '[data-testid="chat-transcript-scroll-viewport"]';
const TRANSCRIPT_INNER_SELECTOR = '[data-testid="chat-transcript-inner"]';
const UTILITY_STACK_SELECTOR = '[data-testid="transcript-utility-stack"]';
const FOOTER_HEADER_SELECTOR = '[aria-controls^="event-subscriptions-body"]';
const TRACE_CATEGORIES = [
  '-*',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.invalidationTracking',
  'disabled-by-default-devtools.timeline.stack',
  'blink.user_timing',
  'v8.execute',
];
const MAX_INFLATION_CLONES = 5000;
const TOGGLE_SETTLE_MS = 700;
const TOGGLE_TIMEOUT_MS = 5000;
const BROWSER_VIEWPORT = { width: 1280, height: 900 };

class UsageError extends Error {}

function installPageHelper(page, { frames }) {
  return page.evaluate(
    ({ viewportSelector, frames }) => {
      const viewport = document.querySelector(viewportSelector);
      const helper = {
        anchor: null,
        frames: [],
        pickAnchor() {
          const bounds = viewport.getBoundingClientRect();
          helper.anchor =
            [...viewport.querySelectorAll('[data-lazy-turn-key]')]
              .filter((node) => !node.closest('[data-inflated]'))
              .find((node) => {
                const rect = node.getBoundingClientRect();
                return rect.bottom > bounds.top + 40 && rect.top < bounds.bottom;
              }) ?? null;
          return helper.anchor !== null;
        },
        geometry() {
          return { top: viewport.scrollTop, max: viewport.scrollHeight - viewport.clientHeight };
        },
        quietKey() {
          return `${viewport.scrollTop},${viewport.scrollHeight}`;
        },
        frame() {
          const anchor = helper.anchor;
          return {
            ...helper.geometry(),
            anchorTop: anchor ? anchor.getBoundingClientRect().top : undefined,
            anchorConnected: anchor ? anchor.isConnected : undefined,
          };
        },
        startSampling() {
          helper.frames = [];
          let count = 0;
          const tick = () => {
            helper.frames.push(helper.frame());
            if (++count < frames) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        },
      };
      window.__chatMotion = helper;
    },
    { viewportSelector: VIEWPORT_SELECTOR, frames },
  );
}

function inflateTranscript(page, target) {
  return page.evaluate(
    ({ innerSelector, utilitySelector, viewportSelector, target, maxClones }) => {
      const inner = document.querySelector(innerSelector);
      const utility = document.querySelector(utilitySelector);
      if (!inner || !utility) throw new Error('transcript inner or utility stack not found');
      if (target > 0) {
        const donors = [...inner.children].filter(
          (child) =>
            child !== utility &&
            child.querySelectorAll('*').length > 20 &&
            child.getBoundingClientRect().height < 2000,
        );
        if (!donors.length) throw new Error('no transcript donor rows to inflate from');
        const stress = document.createElement('div');
        stress.style.cssText = 'height:0;overflow:hidden;pointer-events:none;';
        stress.inert = true;
        utility.prepend(stress);
        let index = 0;
        while (document.querySelectorAll('*').length < target && index < maxClones) {
          const clone = donors[index % donors.length].cloneNode(true);
          clone.setAttribute('data-inflated', '');
          stress.append(clone);
          index += 1;
        }
      }
      const viewport = document.querySelector(viewportSelector);
      viewport.scrollTop = viewport.scrollHeight;
      return {
        total: document.querySelectorAll('*').length,
        transcript: inner.querySelectorAll('*').length,
      };
    },
    {
      innerSelector: TRANSCRIPT_INNER_SELECTOR,
      utilitySelector: UTILITY_STACK_SELECTOR,
      viewportSelector: VIEWPORT_SELECTOR,
      target,
      maxClones: MAX_INFLATION_CLONES,
    },
  );
}

function readState(page, headerSelector) {
  return page.evaluate((selector) => {
    const header = document.querySelector(selector);
    return {
      ...window.__chatMotion.geometry(),
      expanded: header?.getAttribute('aria-expanded') === 'true',
    };
  }, headerSelector);
}

async function waitForFrames(page, frames) {
  await page.waitForFunction((count) => window.__chatMotion.frames.length >= count, frames, {
    timeout: frames * 250 + 2000,
  });
  return page.evaluate(() => window.__chatMotion.frames);
}

async function toggle(page, { label, mark, headerSelector, pointer }) {
  const before = await readState(page, headerSelector);
  await page.evaluate((name) => performance.mark(name), mark);
  const header = page.locator(headerSelector);
  if (pointer) await header.click({ timeout: TOGGLE_TIMEOUT_MS });
  else await header.evaluate((node) => node.click());
  await page.waitForTimeout(TOGGLE_SETTLE_MS);
  const after = await readState(page, headerSelector);
  if (before.expanded === after.expanded) throw new Error(`${label} did not toggle`);
  return { before, after };
}

async function sampleToggle(page, samples, { label, headerSelector, pointer, frames }) {
  await page.evaluate(() => window.__chatMotion.startSampling());
  const result = await toggle(page, { label, mark: label, headerSelector, pointer });
  samples[label] = { ...result, frames: await waitForFrames(page, frames) };
}

async function sampleControl(page, samples, { headerSelector, frames }) {
  await page.evaluate(() => window.__chatMotion.startSampling());
  const before = await readState(page, headerSelector);
  const sampled = await waitForFrames(page, frames);
  const after = await readState(page, headerSelector);
  samples.control = { before, after, frames: sampled };
}

async function scrollUp(page, pixels) {
  await page.locator(VIEWPORT_SELECTOR).evaluate((node, deltaY) => {
    node.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -deltaY, bubbles: true }));
    node.scrollTop -= deltaY;
    node.dispatchEvent(new Event('scroll'));
  }, pixels);
}

async function waitForQuiescence(page, { quietMs, quietTimeout }) {
  await page.evaluate(() => {
    const helper = window.__chatMotion;
    helper.quiet = {
      value: helper.quietKey(),
      since: performance.now(),
      startedAt: performance.now(),
      lastChange: null,
    };
  });
  try {
    await page.waitForFunction(
      (quietMs) => {
        const helper = window.__chatMotion;
        const current = helper.quietKey();
        const now = performance.now();
        if (helper.quiet.value !== current) {
          helper.quiet.lastChange = {
            from: helper.quiet.value,
            to: current,
            atMs: now - helper.quiet.startedAt,
          };
          helper.quiet.value = current;
          helper.quiet.since = now;
        }
        return now - helper.quiet.since >= quietMs;
      },
      quietMs,
      { timeout: quietTimeout },
    );
  } catch (error) {
    const change = await page.evaluate(() => window.__chatMotion.quiet.lastChange);
    const detail = change
      ? `last change scrollTop,scrollHeight ${change.from} -> ${change.to} at +${change.atMs.toFixed(0)}ms`
      : 'no geometry change observed';
    throw new Error(
      `scroll geometry did not stay quiet for ${quietMs}ms within ${quietTimeout}ms (${detail}): ${error.message}`,
    );
  }
  const waitedMs = await page.evaluate(
    () => performance.now() - window.__chatMotion.quiet.startedAt,
  );
  return { waitedMs: Math.round(waitedMs), quietMs };
}

async function runFooterScenario(page, options, outDir) {
  const headerSelector = FOOTER_HEADER_SELECTOR;
  const [collapseMark, expandMark] = SCENARIOS.footer.marks;
  const { frames } = options;
  await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: options.timeout });
  await page.waitForSelector(headerSelector, { timeout: options.timeout });
  if ((await page.locator(headerSelector).getAttribute('aria-expanded')) !== 'true') {
    await page.locator(headerSelector).evaluate((node) => node.click());
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.getAttribute('aria-expanded') === 'true',
      headerSelector,
      { timeout: TOGGLE_TIMEOUT_MS },
    );
    await page.waitForTimeout(TOGGLE_SETTLE_MS);
  }
  const nodeCounts = await inflateTranscript(page, options.inflate);
  await page.waitForTimeout(1000);
  await installPageHelper(page, { frames });
  const preTrace = await waitForQuiescence(page, options);

  await page
    .context()
    .browser()
    .startTracing(page, {
      path: path.join(outDir, 'trace.json'),
      categories: TRACE_CATEGORIES,
    });
  await toggle(page, { label: collapseMark, mark: collapseMark, headerSelector, pointer: true });
  await toggle(page, { label: expandMark, mark: expandMark, headerSelector, pointer: true });
  const traceBuffer = await page.context().browser().stopTracing();
  const parsedTrace = JSON.parse(traceBuffer.toString('utf8'));
  const traceEvents = Array.isArray(parsedTrace) ? parsedTrace : parsedTrace.traceEvents;
  await page.screenshot({ path: path.join(outDir, 'expanded.png') });

  const samples = {};
  const pickAnchor = () => page.evaluate(() => window.__chatMotion.pickAnchor());
  await pickAnchor();
  await sampleToggle(page, samples, {
    label: 'pinnedCollapse',
    headerSelector,
    pointer: true,
    frames,
  });
  await page.screenshot({ path: path.join(outDir, 'collapsed.png') });
  await pickAnchor();
  await sampleToggle(page, samples, {
    label: 'pinnedExpand',
    headerSelector,
    pointer: true,
    frames,
  });

  await scrollUp(page, options.scrollUp);
  const scrolledUp = await waitForQuiescence(page, options);
  const quiescence = { preTraceWaitedMs: preTrace.waitedMs, ...scrolledUp };
  if (!(await pickAnchor())) {
    throw new Error(
      'no non-inflated [data-lazy-turn-key] row intersects the viewport after scrolling up',
    );
  }
  await sampleControl(page, samples, { headerSelector, frames });
  await sampleToggle(page, samples, {
    label: 'scrolledUpCollapse',
    headerSelector,
    pointer: false,
    frames,
  });
  await sampleToggle(page, samples, {
    label: 'scrolledUpExpand',
    headerSelector,
    pointer: false,
    frames,
  });
  await page.screenshot({ path: path.join(outDir, 'scrolled-up.png') });

  return { nodeCounts, traceEvents, samples, quiescence };
}

const SCENARIO_RUNNERS = { footer: runFooterScenario };

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    throw new UsageError(`${error.message}\n${USAGE}`);
  }
  const run = SCENARIO_RUNNERS[options.scenario];
  if (!run) throw new UsageError(`--scenario ${options.scenario} is not implemented yet.`);
  let outDir;
  try {
    outDir = await prepareOutDir(options.out);
  } catch (error) {
    if (error.message.startsWith('refusing to overwrite')) throw new UsageError(error.message);
    throw error;
  }
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ headless: !options.headed });
  let result;
  try {
    const page = await browser.newPage({ viewport: BROWSER_VIEWPORT });
    result = await run(page, options, outDir);
  } finally {
    await browser.close();
  }
  const summary = summarize({ url: options.url, scenario: options.scenario, startedAt, ...result });
  await writeFile(
    path.join(outDir, 'samples.json'),
    `${JSON.stringify(result.samples, null, 2)}\n`,
  );
  await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(`perf:chat-motion: ${error instanceof Error ? error.message : error}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
