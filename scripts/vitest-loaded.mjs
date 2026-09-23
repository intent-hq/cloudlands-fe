#!/usr/bin/env node
// Runs a vitest file under simulated CI runner load.
//
//   pnpm test:loaded <file or filter> [-- <extra vitest args>]
//
// The shared CI runners can starve a test fork ~4x (intent-hq/monorepo#3082):
// perf guards that take a few seconds locally then blow the 60s CI budget while
// passing in isolation, and each miss costs a 15-20 min CI cycle
// (cloudlands-fe#2740 went red three times this way). This harness reproduces
// that condition on a developer machine: it pins vitest (one worker, the
// default `vitest.config.ts`) to a single core it shares with N busy loops, so
// the fork sees roughly 1/(N+1) of a core. The recipe that reproduced #2740's
// failures was `taskset -c 31` plus three busy loops.
//
// Linux only for the pinning (`taskset`); elsewhere the busy loops run
// unpinned against every core and the slowdown is much weaker, which the run
// says up front. `CI` is deliberately left alone: the point is whether a test
// fits the local 30s `testTimeout` under load. Environment overrides:
//   LOADED_CORE=<n>  core to pin to (default: the last core this process may
//                    run on, per /proc/self/status; else the last online core)
//   LOADED_BUSY=<n>  number of busy loops (default: 3)
//
// The busy loops exit on their own when this process disappears (they are
// told this pid and watch their parent pid against it), on top of being killed
// on every exit path here.

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCLI } from 'vitest/node';

export const DEFAULT_BUSY = 3;
export const VITEST_CONFIG = 'vitest.config.ts';
export const USAGE = 'Usage: pnpm test:loaded <vitest file or filter> [-- <extra vitest args>]';

// A CPU-bound loop, run as `node -e BUSY_LOOP_SOURCE <harness pid>`, that
// exits as soon as its parent pid is not the harness — checked before the first
// burst and between bursts, so a harness SIGKILLed even before the loop's own
// startup finished (the loop then starts already reparented) cannot leave it
// behind. The pid is passed in rather than read from `process.ppid` at startup
// for that reason.
export const BUSY_LOOP_SOURCE =
  'const parent = Number(process.argv[1]); for (;;) { if (process.ppid !== parent) process.exit(0); for (let i = 0; i < 1e7; i += 1); }';

/** Parses a Linux cpu list (`0-31`, `0-3,5,7-8`) into the sorted core ids it names. */
export function parseCpuList(text) {
  const cores = new Set();
  for (const part of text.trim().split(',')) {
    if (part === '') continue;
    const match = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!match) throw new Error(`Unrecognised cpu list entry: ${JSON.stringify(part)}`);
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    for (let core = start; core <= end; core += 1) cores.add(core);
  }
  return [...cores].sort((a, b) => a - b);
}

/**
 * The cores this process may run on, from the `Cpus_allowed_list:` line of a
 * `/proc/self/status` text, or `null` when the text has no such line. This is
 * narrower than the machine's online list under a cpuset/cgroup restriction,
 * where pinning to an online-but-disallowed core makes every `taskset` fail.
 */
export function parseAllowedCpuList(statusText) {
  const match = /^Cpus_allowed_list:\s*(\S+)\s*$/m.exec(statusText);
  return match ? parseCpuList(match[1]) : null;
}

/** The core to pin to: `LOADED_CORE` when set, else the last usable core. */
export function pickCore(usableCores, requested) {
  if (requested !== undefined && requested !== '') {
    const core = Number(requested);
    if (!Number.isInteger(core) || core < 0) {
      throw new Error(
        `LOADED_CORE must be a non-negative integer, got ${JSON.stringify(requested)}`,
      );
    }
    if (usableCores.length && !usableCores.includes(core)) {
      throw new Error(
        `LOADED_CORE=${core} is not a core this process may run on (usable: ${usableCores.join(',')})`,
      );
    }
    return core;
  }
  if (!usableCores.length) throw new Error('No usable core found to pin to');
  return usableCores[usableCores.length - 1];
}

/** The busy-loop count: `LOADED_BUSY` when set, else `DEFAULT_BUSY`. */
export function pickBusyCount(requested) {
  if (requested === undefined || requested === '') return DEFAULT_BUSY;
  const count = Number(requested);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`LOADED_BUSY must be a non-negative integer, got ${JSON.stringify(requested)}`);
  }
  return count;
}

/**
 * The vitest arguments from the harness argv: every bare `--` dropped (pnpm may
 * forward the user's separator), and at least one file or filter required so a
 * typo does not run the whole suite pinned to one core. Vitest's own CLI parser
 * decides what is a filter, so an option value such as `--reporter verbose` or
 * `--testTimeout 15000` does not pass for one.
 */
export function parseArgs(argv) {
  const vitestArgs = argv.filter((arg) => arg !== '--');
  if (parseCLI(['vitest', 'run', ...vitestArgs]).filter.length === 0) {
    throw new Error(`No test file or filter given.\n${USAGE}`);
  }
  return vitestArgs;
}

/**
 * The commands to run: `busy` loops told `harnessPid` to watch for, then
 * `vitest`, both prefixed with `taskset -c <core>` when `pinned`. Vitest runs
 * the default config with one worker so the whole file shares the pinned core
 * with the busy loops.
 */
export function planRun({ execPath, vitestBin, vitestArgs, core, busy, pinned, harnessPid }) {
  const prefix = pinned ? ['taskset', '-c', String(core)] : [];
  const command = (args) => {
    const argv = [...prefix, execPath, ...args];
    return { executable: argv[0], args: argv.slice(1) };
  };
  return {
    busy: Array.from({ length: busy }, () => command(['-e', BUSY_LOOP_SOURCE, String(harnessPid)])),
    vitest: command([vitestBin, 'run', '--config', VITEST_CONFIG, '--maxWorkers=1', ...vitestArgs]),
    notice: pinned
      ? `test:loaded: vitest pinned to core ${core} with ${busy} busy loop(s)`
      : `test:loaded: no taskset on ${process.platform}; running ${busy} unpinned busy loop(s) instead, so the slowdown is weaker than on a CI runner`,
  };
}

// The cores to choose the default from: the set this process is allowed to run
// on, else the online list, else every cpu Node reports.
function readUsableCores() {
  try {
    const allowed = parseAllowedCpuList(readFileSync('/proc/self/status', 'utf8'));
    if (allowed && allowed.length) return allowed;
  } catch {
    // fall through to the online list
  }
  try {
    return parseCpuList(readFileSync('/sys/devices/system/cpu/online', 'utf8'));
  } catch {
    return os.cpus().map((_, index) => index);
  }
}

function hasTaskset() {
  if (process.platform !== 'linux') return false;
  return spawnSync('taskset', ['--version'], { stdio: 'ignore' }).status === 0;
}

function resolveVitestBin() {
  const require = createRequire(import.meta.url);
  const vitestPackage = require.resolve('vitest/package.json');
  return path.join(path.dirname(vitestPackage), require(vitestPackage).bin.vitest);
}

function main(argv, env) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const pinned = hasTaskset();
  const plan = planRun({
    execPath: process.execPath,
    vitestBin: resolveVitestBin(),
    vitestArgs: parseArgs(argv),
    core: pinned ? pickCore(readUsableCores(), env.LOADED_CORE) : undefined,
    busy: pickBusyCount(env.LOADED_BUSY),
    pinned,
    harnessPid: process.pid,
  });
  console.error(plan.notice);

  const loops = plan.busy.map(({ executable, args }) =>
    spawn(executable, args, { cwd: root, stdio: 'ignore' }),
  );
  const vitest = spawn(plan.vitest.executable, plan.vitest.args, { cwd: root, stdio: 'inherit' });
  let signalled;
  const stopLoops = () => {
    for (const loop of loops) if (loop.exitCode === null && !loop.killed) loop.kill('SIGKILL');
  };
  const onSignal = (signal) => {
    signalled = signal;
    stopLoops();
    if (vitest.exitCode === null) vitest.kill(signal);
    else process.exit(128 + os.constants.signals[signal]);
  };
  process.on('exit', stopLoops);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, onSignal);

  vitest.on('error', (error) => {
    console.error(`test:loaded: failed to start vitest: ${error.message}`);
    process.exit(1);
  });
  vitest.on('exit', (code, signal) => {
    stopLoops();
    if (code !== null) process.exit(code);
    const name = signal ?? signalled ?? 'SIGTERM';
    console.error(`test:loaded: vitest was terminated by ${name}`);
    process.exit(128 + (os.constants.signals[name] ?? 15));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(`test:loaded: ${error.message}`);
    process.exit(2);
  }
}
