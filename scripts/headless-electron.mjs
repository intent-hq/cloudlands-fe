#!/usr/bin/env node
// Launch the built desktop app headlessly against an existing daemon, open a
// route, save a screenshot, and optionally run a check module. See USAGE in
// headless-electron-lib.mjs and AGENTS.md → "Loop B".
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  USAGE,
  UsageError,
  XVFB_MARKER,
  defaultScreenshotPath,
  electronLaunchOptions,
  needsVirtualDisplay,
  parseHeadlessArgs,
  resolveIntentdSocketPath,
  routeUrl,
  xvfbCommand,
} from './headless-electron-lib.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const appDir = path.resolve(path.dirname(scriptPath), '..');
const CLOSE_TIMEOUT_MS = 15_000;

function fail(message) {
  console.error(`electron:headless: ${message}`);
  process.exit(1);
}

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const SIGNAL_GRACE_MS = CLOSE_TIMEOUT_MS + 5_000;

function exitCodeFor(signal) {
  return 128 + os.constants.signals[signal];
}

function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

function reexecUnderXvfb(argv) {
  const { command, args } = xvfbCommand(process.execPath, scriptPath, argv);
  let child = null;
  let cancelledBy = null;
  // Handlers go in before the spawn: a signal that arrived after the child
  // started but before they existed would kill this process and orphan the
  // group. Node delivers it on a later tick, once `child` is set.
  for (const signal of SIGNALS) {
    process.on(signal, async () => {
      if (cancelledBy) return;
      cancelledBy = signal;
      if (!child?.pid) process.exit(exitCodeFor(signal));
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group is already gone.
      }
      // Wait for the inner cleanup, then force whatever remains.
      const deadline = Date.now() + SIGNAL_GRACE_MS;
      while (groupAlive(child.pid) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (groupAlive(child.pid)) process.kill(-child.pid, 'SIGKILL');
      process.exit(exitCodeFor(signal));
    });
  }
  // Own process group: xvfb-run is a shell that dies on a signal without
  // passing it on, so cancellation is delivered to the whole group (xvfb-run,
  // Xvfb and the inner runner, which closes Electron and removes its profile).
  child = spawn(command, args, {
    stdio: 'inherit',
    detached: true,
    env: { ...process.env, [XVFB_MARKER]: '1' },
  });
  child.on('error', (error) => {
    if (error.code === 'ENOENT') {
      fail(
        'no display and xvfb-run is not installed. Install it (Debian/Ubuntu: ' +
          '`sudo apt-get install -y xvfb`) or set DISPLAY.',
      );
    }
    fail(`xvfb-run failed to start: ${error.message}`);
  });
  child.on('exit', (code, signal) => {
    if (!cancelledBy) process.exit(signal ? 1 : (code ?? 1));
  });
}

function assertBuilt() {
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const main = path.join(appDir, pkg.main);
  if (!fs.existsSync(main)) {
    fail(`built app not found (${path.relative(appDir, main)}). Run \`pnpm run build\` first.`);
  }
}

function assertSocket(socket) {
  let stat;
  try {
    stat = fs.statSync(socket);
  } catch {
    fail(`no daemon socket at ${socket}. Start intentd or pass --socket <path>.`);
  }
  if (!stat.isSocket()) fail(`${socket} is not a socket.`);
}

async function waitForRenderer(page, timeout) {
  // The splash element is removed once the root Svelte layout mounts.
  await page.waitForLoadState('domcontentloaded', { timeout });
  await page.waitForFunction(() => document.getElementById('splash') === null, undefined, {
    timeout,
  });
}

/** Close through the app's own quit path; kill it if that wedges. */
async function closeApp(app) {
  const child = app.process();
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once('exit', resolve));
  let timer;
  const closed = await Promise.race([
    app.close().then(
      () => true,
      () => false,
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), CLOSE_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (!closed && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await exited;
}

async function run(options) {
  assertBuilt();
  const socket = options.socket ?? resolveIntentdSocketPath();
  assertSocket(socket);
  const out = options.out
    ? path.resolve(options.out)
    : defaultScreenshotPath(appDir, options.route);
  const check = options.check ? path.resolve(options.check) : null;
  if (check && !fs.existsSync(check)) fail(`--check module not found: ${check}`);

  // Imported lazily so --help and argument errors work without node_modules.
  const { _electron: electron } = await import('@playwright/test');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-headless-electron-'));
  const consoleErrors = [];
  let app;
  let failure;
  let cleanup;
  const cleanupOnce = () =>
    (cleanup ??= (async () => {
      if (app) await closeApp(app);
      if (options.keepProfile) console.log(`profile: ${userDataDir}`);
      else fs.rmSync(userDataDir, { recursive: true, force: true });
    })());
  for (const signal of SIGNALS) {
    process.once(signal, async () => {
      console.error(`electron:headless: ${signal}, closing the app`);
      await cleanupOnce().catch((error) => console.error(error));
      process.exit(exitCodeFor(signal));
    });
  }
  try {
    app = await electron.launch({
      ...electronLaunchOptions({ appDir, userDataDir, socket }),
      timeout: options.timeoutMs,
    });
    const page = await app.firstWindow({ timeout: options.timeoutMs });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    await waitForRenderer(page, options.timeoutMs);
    if (options.route !== '/') {
      await page.goto(routeUrl(options.route), { timeout: options.timeoutMs });
      await waitForRenderer(page, options.timeoutMs);
    }
    if (options.waitFor) {
      await page
        .locator(options.waitFor)
        .first()
        .waitFor({ state: 'visible', timeout: options.timeoutMs });
    }
    if (options.settleMs > 0) await page.waitForTimeout(options.settleMs);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    console.log(`url: ${page.url()}`);
    console.log(`screenshot: ${out}`);
    if (check) {
      const mod = await import(pathToFileURL(check).href);
      if (typeof mod.default !== 'function') {
        throw new Error(`--check module must default-export a function: ${check}`);
      }
      await mod.default({ app, page, route: options.route });
      console.log(`check: passed (${check})`);
    }
  } catch (error) {
    failure = error;
  } finally {
    await cleanupOnce();
  }
  if (consoleErrors.length > 0) {
    console.log(`console errors (${consoleErrors.length}):`);
    for (const line of consoleErrors) console.log(`  ${line}`);
  }
  if (failure) fail(failure instanceof Error ? (failure.stack ?? failure.message) : failure);
}

const argv = process.argv.slice(2);
let options;
try {
  options = parseHeadlessArgs(argv);
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`electron:headless: ${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  throw error;
}
if (options.help) {
  console.log(USAGE);
} else if (needsVirtualDisplay()) {
  reexecUnderXvfb(argv);
} else {
  await run(options);
}
