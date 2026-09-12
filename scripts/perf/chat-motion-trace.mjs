#!/usr/bin/env node

// Chat-motion perf trace harness. Drives Playwright Chromium against a running app
// sandbox, records a CDP trace around one motion pair, then samples scroll geometry per
// animation frame: pinned toggles, a scrolled-up no-toggle control after a
// hydration-quiescence wait, and scrolled-up toggles. Scenarios:
//   footer        — the transcript footer (event subscriptions) collapse/expand
//   context-well  — the sidebar Context card open/close (launcher tile → card close button)
// Prerequisites: `make dev-sandbox-app` (or `dev-sandbox-stack`) is healthy and `--url`
// is a workspace page whose transcript is long enough to scroll. `--out` must not exist.
// Example:
//   pnpm perf:chat-motion --url http://127.0.0.1:8264/workspace/<id> --out .demo-artifacts/perf/footer-1
//   pnpm perf:chat-motion --scenario context-well --url http://127.0.0.1:8264/workspace/<id> --out .demo-artifacts/perf/context-well-1
// Writes trace.json, summary.json, samples.json and screenshots into --out and prints the
// summary JSON. Exit 0 on success, 1 on runtime failure, 2 for usage / refused overwrite.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  SCENARIOS,
  parseArgs,
  prepareOutDir,
  scrollSampleLabels,
  summarize,
} from './chat-motion-lib.mjs';

const USAGE =
  'usage: pnpm perf:chat-motion --url <app-url> --out <dir> [--scenario footer|context-well] [--inflate 10000] [--frames 40] [--scroll-up 800] [--quiet-ms 750] [--quiet-timeout 15000] [--timeout 180000] [--headed]';
const VIEWPORT_SELECTOR = '[data-testid="chat-transcript-scroll-viewport"]';
const TRANSCRIPT_INNER_SELECTOR = '[data-testid="chat-transcript-inner"]';
const UTILITY_STACK_SELECTOR = '[data-testid="transcript-utility-stack"]';
const FOOTER_HEADER_SELECTOR = '[aria-controls^="event-subscriptions-body"]';
const CONTEXT_LAUNCHER_SELECTOR = '[data-sidebar-launcher="context"] button[aria-expanded="false"]';
const CONTEXT_CARD_SELECTOR = '[data-sidebar-card-surface][data-sidebar-card-tab="context"]';
const CONTEXT_CLOSE_SELECTOR = `${CONTEXT_CARD_SELECTOR} [data-sidebar-close]`;
const ANY_CARD_CLOSE_SELECTOR =
  '[data-sidebar-card-surface][data-sidebar-card-tab] [data-sidebar-close]';
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

// The sidebar mounts before the transcript hydrates, so a scenario whose starting state
// does not live in the transcript must wait for a rendered turn before inflating.
function waitForTranscriptRows(page, options) {
  return page.waitForFunction(
    ({ innerSelector, utilitySelector }) => {
      const inner = document.querySelector(innerSelector);
      const utility = document.querySelector(utilitySelector);
      if (!inner || !utility) return false;
      return [...inner.children].some(
        (child) => child !== utility && child.querySelectorAll('*').length > 20,
      );
    },
    { innerSelector: TRANSCRIPT_INNER_SELECTOR, utilitySelector: UTILITY_STACK_SELECTOR },
    { timeout: options.timeout },
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

// A motion target describes how a scenario reads its expanded state and which control
// toggles it: `state.kind` is `aria-expanded` (attribute on `state.selector`) or
// `presence` (`state.selector` exists in the DOM); `control(expanded)` is the selector to
// click from that state; `prepare` brings the page to the scenario's starting state.
function readState(page, { state }) {
  return page.evaluate(({ kind, selector }) => {
    const node = document.querySelector(selector);
    return {
      ...window.__chatMotion.geometry(),
      expanded:
        kind === 'presence' ? node !== null : node?.getAttribute('aria-expanded') === 'true',
    };
  }, state);
}

async function waitForFrames(page, frames) {
  await page.waitForFunction((count) => window.__chatMotion.frames.length >= count, frames, {
    timeout: frames * 250 + 2000,
  });
  return page.evaluate(() => window.__chatMotion.frames);
}

async function toggle(page, { label, mark, target, pointer }) {
  const before = await readState(page, target);
  const controlSelector = target.control(before.expanded);
  await page.waitForSelector(controlSelector, { state: 'attached', timeout: TOGGLE_TIMEOUT_MS });
  await page.evaluate((name) => performance.mark(name), mark);
  const control = page.locator(controlSelector);
  if (pointer) await control.click({ timeout: TOGGLE_TIMEOUT_MS });
  else await control.evaluate((node) => node.click());
  await page.waitForTimeout(TOGGLE_SETTLE_MS);
  const after = await readState(page, target);
  if (before.expanded === after.expanded) throw new Error(`${label} did not toggle`);
  return { before, after };
}

async function sampleToggle(page, samples, { label, target, pointer, frames }) {
  await page.evaluate(() => window.__chatMotion.startSampling());
  const result = await toggle(page, { label, mark: label, target, pointer });
  samples[label] = { ...result, frames: await waitForFrames(page, frames) };
}

async function sampleControl(page, samples, { target, frames }) {
  await page.evaluate(() => window.__chatMotion.startSampling());
  const before = await readState(page, target);
  const sampled = await waitForFrames(page, frames);
  const after = await readState(page, target);
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

const FOOTER_TARGET = {
  state: { kind: 'aria-expanded', selector: FOOTER_HEADER_SELECTOR },
  control: () => FOOTER_HEADER_SELECTOR,
  screenshots: { afterTrace: 'expanded.png', afterFirstMotion: 'collapsed.png' },
  async prepare(page, options) {
    const headerSelector = FOOTER_HEADER_SELECTOR;
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
  },
};

const CONTEXT_WELL_TARGET = {
  state: { kind: 'presence', selector: CONTEXT_CARD_SELECTOR },
  control: (expanded) => (expanded ? CONTEXT_CLOSE_SELECTOR : CONTEXT_LAUNCHER_SELECTOR),
  screenshots: { afterTrace: 'closed.png', afterFirstMotion: 'opened.png' },
  async prepare(page, options) {
    // The launcher grid unmounts while any card is expanded; close it to reach the tiles.
    await page.waitForSelector(`${CONTEXT_LAUNCHER_SELECTOR}, ${ANY_CARD_CLOSE_SELECTOR}`, {
      state: 'attached',
      timeout: options.timeout,
    });
    const openCardClose = page.locator(ANY_CARD_CLOSE_SELECTOR);
    if ((await openCardClose.count()) > 0) {
      await openCardClose.first().evaluate((node) => node.click());
      await page.waitForTimeout(TOGGLE_SETTLE_MS);
    }
    await page.waitForSelector(CONTEXT_LAUNCHER_SELECTOR, {
      state: 'attached',
      timeout: TOGGLE_TIMEOUT_MS,
    });
  },
};

async function runScenario(page, options, outDir, target) {
  const [firstMark, secondMark] = SCENARIOS[options.scenario].marks;
  const labels = scrollSampleLabels(options.scenario);
  const { frames } = options;
  await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: options.timeout });
  await target.prepare(page, options);
  await waitForTranscriptRows(page, options);
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
  await toggle(page, { label: firstMark, mark: firstMark, target, pointer: true });
  await toggle(page, { label: secondMark, mark: secondMark, target, pointer: true });
  const traceBuffer = await page.context().browser().stopTracing();
  const parsedTrace = JSON.parse(traceBuffer.toString('utf8'));
  const traceEvents = Array.isArray(parsedTrace) ? parsedTrace : parsedTrace.traceEvents;
  await page.screenshot({ path: path.join(outDir, target.screenshots.afterTrace) });

  const samples = {};
  const pickAnchor = () => page.evaluate(() => window.__chatMotion.pickAnchor());
  await pickAnchor();
  await sampleToggle(page, samples, {
    label: labels.pinned[0],
    target,
    pointer: true,
    frames,
  });
  await page.screenshot({ path: path.join(outDir, target.screenshots.afterFirstMotion) });
  await pickAnchor();
  await sampleToggle(page, samples, {
    label: labels.pinned[1],
    target,
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
  await sampleControl(page, samples, { target, frames });
  await sampleToggle(page, samples, {
    label: labels.scrolledUp[0],
    target,
    pointer: false,
    frames,
  });
  await sampleToggle(page, samples, {
    label: labels.scrolledUp[1],
    target,
    pointer: false,
    frames,
  });
  await page.screenshot({ path: path.join(outDir, 'scrolled-up.png') });

  return { nodeCounts, traceEvents, samples, quiescence };
}

const SCENARIO_TARGETS = { footer: FOOTER_TARGET, 'context-well': CONTEXT_WELL_TARGET };

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    throw new UsageError(`${error.message}\n${USAGE}`);
  }
  const target = SCENARIO_TARGETS[options.scenario];
  if (!target) throw new UsageError(`--scenario ${options.scenario} is not implemented yet.`);
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
    result = await runScenario(page, options, outDir, target);
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
