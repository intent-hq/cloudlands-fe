#!/usr/bin/env node
/**
 * Manual, bounded browser regression experiment for intent-hq/intent#5481.
 * Run with the CT-aligned 1.58.2 driver, never the top-level Playwright:
 * node scripts/ct-promise-lifetime.mjs --executable /absolute/browser \
 *   --version 153.0.8010.12 --output /new/artifact.json
 *
 * The WeakRef cases deliberately remove application ownership. They test engine
 * lifetime, NOT the natural mount flake. The productive cases keep a resolver
 * reachable and exercise the public page.evaluate -> UtilityScript path.
 * No browser defaults, dependency methods or product components are patched.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { resolveCtAlignedPlaywrightCli } from './run-ct-tests.mjs';

const { values } = parseArgs({
  options: {
    executable: { type: 'string' },
    version: { type: 'string' },
    output: { type: 'string' },
  },
});
assert(values.executable && values.version && values.output, 'Supply all three options');
assert(!existsSync(values.output), 'Use a new output path; preserve previous results');
const cli = resolveCtAlignedPlaywrightCli();
assert.equal(cli.version, '1.58.2', 'Revalidate this diagnostic for another CT driver');
const require = createRequire(cli.cliPath);
const { chromium } = require('playwright');
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const executable = realpathSync(values.executable);
const report = {
  startedAt: new Date().toISOString(),
  command: [process.execPath, ...process.argv.slice(1)],
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }),
  diagnosticSha256: digest(new URL(import.meta.url)),
  driver: cli,
  executable,
  executableSha256: digest(executable),
  executableVersion: execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim(),
  cases: [],
};
const save = () => writeFileSync(values.output, `${JSON.stringify(report, null, 2)}\n`);
save();

async function bounded(promise, label, milliseconds = 10_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: deadline exceeded`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const observe = (promise) =>
  promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (error) => ({ status: 'rejected', error: String(error) }),
  );

const weakDeferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  promise.resolve = resolve;
  globalThis.lifetimeWeak = new WeakRef(promise);
  return promise;
};
const ownedDeferred = () =>
  new Promise((resolve) => {
    globalThis.lifetimeResolve = resolve;
  });

const browser = await chromium.launch({ executablePath: executable });

async function run(name, body) {
  const started = Date.now();
  const result = { name, observations: {} };
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await bounded(body({ context, page, session, evidence: result.observations }), name, 20_000);
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.error = String(error);
    process.exitCode = 1;
  } finally {
    await bounded(context.close(), `${name} cleanup`);
    result.elapsedMs = Date.now() - started;
    report.cases.push(result);
    save();
    console.log(`${result.status}: ${name}`);
  }
}

async function rawDeferred(session, extra = {}) {
  const { result } = await session.send('Runtime.evaluate', { expression: 'globalThis' });
  return {
    pending: observe(
      session.send('Runtime.callFunctionOn', {
        objectId: result.objectId,
        functionDeclaration: String(weakDeferred),
        awaitPromise: true,
        returnByValue: true,
        ...extra,
      }),
    ),
  };
}

async function weakAlive(session) {
  const { result } = await session.send('Runtime.evaluate', {
    expression: 'lifetimeWeak.deref() !== undefined',
    returnByValue: true,
  });
  return result.value;
}

try {
  assert.equal(browser.version(), values.version, 'Launched browser must match the candidate');
  const browserSession = await browser.newBrowserCDPSession();
  report.browser = await browserSession.send('Browser.getVersion');
  await browserSession.detach();
  save();

  await run(
    'synthetic: raw callFunctionOn retains a deferred result across GC',
    async ({ session, evidence }) => {
      const { pending } = await rawDeferred(session);
      await session.send('HeapProfiler.collectGarbage');
      evidence.aliveAfterGc = await weakAlive(session);
      await session.send('Runtime.evaluate', { expression: 'lifetimeWeak.deref()?.resolve(42)' });
      evidence.response = await bounded(pending, 'raw deferred response');
      assert.equal(evidence.response.status, 'fulfilled');
      assert.equal(evidence.response.value.result.value, 42);
      assert.equal(evidence.aliveAfterGc, true);
    },
  );

  await run(
    'synthetic: UtilityScript cannot rescue a weakly owned input promise',
    async ({ page, session, evidence }) => {
      const pending = observe(page.evaluate(weakDeferred));
      await page.waitForFunction('globalThis.lifetimeWeak !== undefined');
      await session.send('HeapProfiler.collectGarbage');
      evidence.aliveAfterGc = await weakAlive(session);
      await session.send('Runtime.evaluate', { expression: 'lifetimeWeak.deref()?.resolve(42)' });
      evidence.response = await bounded(pending, 'UtilityScript deferred response', 1_000).catch(
        (error) => ({ status: 'pending-at-deadline', error: String(error) }),
      );
      // Report the semantic failure honestly on BOTH browsers. On 145 the
      // inspector rejects; on 153 it retains the outer promise, but the inner
      // promise and its only resolver are gone. Closing the page must still
      // cancel that outstanding request. This is not a natural-flake claim.
      await page.close();
      evidence.afterClose = await bounded(pending, 'cancel deferred response');
      assert.equal(evidence.response.status, 'fulfilled');
      assert.equal(evidence.response.value, 42);
    },
  );

  await run(
    'UtilityScript: productive async values survive GC and serialize',
    async ({ page, session, evidence }) => {
      const expected = { ordinary: [42, 'ready', null], missing: undefined, zero: -0, big: 42n };
      assert.deepEqual(
        await page.evaluate(() => ({
          ordinary: [42, 'ready', null],
          missing: undefined,
          zero: -0,
          big: 42n,
        })),
        expected,
      );
      const pending = page.evaluate(ownedDeferred);
      await page.waitForFunction('typeof globalThis.lifetimeResolve === "function"');
      await session.send('HeapProfiler.collectGarbage');
      await session.send('Runtime.evaluate', {
        expression:
          'lifetimeResolve({ordinary:[42,"ready",null],missing:undefined,zero:-0,big:42n}); delete globalThis.lifetimeResolve',
      });
      assert.deepEqual(await bounded(pending, 'productive async values'), expected);
      evidence.preserved = ['ordinary values', 'undefined', 'negative zero', 'BigInt'];
    },
  );

  await run(
    'UtilityScript: exceptions and deferred rejection propagate',
    async ({ page, session, evidence }) => {
      await assert.rejects(
        page.evaluate(() => {
          throw new Error('lifetime-sync-exception');
        }),
        /lifetime-sync-exception/,
      );
      const pending = observe(
        page.evaluate(
          () =>
            new Promise((_, reject) => {
              globalThis.lifetimeReject = reject;
            }),
        ),
      );
      await page.waitForFunction('typeof globalThis.lifetimeReject === "function"');
      await session.send('HeapProfiler.collectGarbage');
      await session.send('Runtime.evaluate', {
        expression:
          'lifetimeReject(new Error("lifetime-async-rejection")); delete globalThis.lifetimeReject',
      });
      evidence.response = await bounded(pending, 'async rejection');
      assert.equal(evidence.response.status, 'rejected');
      assert.match(evidence.response.error, /lifetime-async-rejection/);
    },
  );

  for (const operation of ['navigation', 'context close']) {
    await run(
      `UtilityScript: ${operation} cancels a pending response`,
      async ({ context, page, evidence }) => {
        const pending = observe(page.evaluate(ownedDeferred));
        await page.waitForFunction('typeof globalThis.lifetimeResolve === "function"');
        if (operation === 'navigation') await page.goto('data:text/html,new-context');
        else await context.close();
        evidence.response = await bounded(pending, operation);
        assert.equal(evidence.response.status, 'rejected');
        assert.match(
          evidence.response.error,
          operation === 'navigation' ? /Execution context was destroyed/ : /closed/,
        );
        if (operation === 'navigation') assert.equal(await page.evaluate(() => 6 * 7), 42);
      },
    );
  }

  await run(
    'raw CDP: releasing an object group releases pending ownership',
    async ({ session, evidence }) => {
      const { pending } = await rawDeferred(session, { objectGroup: 'lifetime-canary' });
      await session.send('Runtime.releaseObjectGroup', { objectGroup: 'lifetime-canary' });
      await session.send('HeapProfiler.collectGarbage');
      evidence.response = await bounded(pending, 'object group release');
      evidence.aliveAfterRelease = await weakAlive(session);
      assert.equal(evidence.response.status, 'rejected');
      assert.match(evidence.response.error, /Promise was collected/);
      assert.equal(evidence.aliveAfterRelease, false);
    },
  );

  await run(
    'raw CDP: session teardown releases pending ownership',
    async ({ context, page, session, evidence }) => {
      const observer = await context.newCDPSession(page);
      const { pending } = await rawDeferred(session);
      await observer.send('HeapProfiler.collectGarbage');
      evidence.aliveBeforeDetach = await weakAlive(observer);
      await session.detach();
      await observer.send('HeapProfiler.collectGarbage');
      evidence.response = await bounded(pending, 'session detach');
      evidence.aliveAfterDetach = await weakAlive(observer);
      assert.equal(evidence.response.status, 'rejected');
      assert.equal(evidence.aliveAfterDetach, false);
      await observer.detach();
    },
  );
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
  throw error;
} finally {
  await bounded(browser.close(), 'browser cleanup');
  report.finishedAt = new Date().toISOString();
  report.exitCode = process.exitCode ?? 0;
  save();
}
