/**
 * Warn when a shared dev host is far busier than its CPU count.
 *
 * Many workspaces share one dev host. When another workspace keeps the 1-minute
 * load well above the core count (a monorepo `make test-stress LOAD=1` run, a
 * big build), component tests here fail with setup and page-call timeouts that
 * say nothing about the code under test: on 2026-11-01 a load of 95-120 on a
 * 32-core host turned a 480-test CT stress check that passes in 12 minutes into
 * 225 timeouts over 2 hours. `checkHostLoad` measures the load once and, when it
 * is at least `HOST_LOAD_FACTOR` times the host's CPU count, names the busiest
 * commands (`ps` CPU share summed by command name). It never fails a run: a
 * missing loadavg (Windows) or `ps` just yields no report or no names.
 *
 * The monorepo's scripts/host_load.py is the same check for `make test-stress`.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export const HOST_LOAD_FACTOR = 1.5;
const BUSIEST_LIMIT = 3;

/** `ps -A -o pcpu=,comm=` output, or '' when ps is unavailable. */
export function psSnapshot({ spawnSyncImpl = spawnSync } = {}) {
  if (process.platform === 'win32') return '';
  const result = spawnSyncImpl('ps', ['-A', '-o', 'pcpu=,comm='], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.error || result.status !== 0 ? '' : (result.stdout ?? '');
}

/**
 * Group `ps -o pcpu=,comm=` lines by command name, busiest total CPU first.
 * @returns {{ command: string, processes: number, cpuPercent: number }[]}
 */
export function busiestCommands(psOutput, limit = BUSIEST_LIMIT) {
  /** @type {Map<string, { processes: number, share: number }>} */
  const totals = new Map();
  for (const line of psOutput.split('\n')) {
    const match = /^\s*(\S+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const share = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(share)) continue;
    // macOS prints the full executable path; Linux the 15-char task name.
    const name = path.posix.basename(match[2]) || match[2];
    if (name === 'ps') continue;
    const entry = totals.get(name) ?? { processes: 0, share: 0 };
    entry.processes += 1;
    entry.share += share;
    totals.set(name, entry);
  }
  return [...totals]
    .sort(([a, x], [b, y]) => y.share - x.share || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, limit)
    .filter(([, entry]) => entry.share >= 1)
    .map(([command, entry]) => ({
      command,
      processes: entry.processes,
      cpuPercent: Math.round(entry.share),
    }));
}

/**
 * A report when the host's 1-minute load is at least `factor` x its CPUs, else
 * null. The load average counts runnable tasks host-wide, so the comparison
 * uses every CPU of the host, not this process's share.
 */
export function checkHostLoad({
  load = os.loadavg()[0],
  cpus = os.cpus().length || 1,
  psOutput,
  factor = HOST_LOAD_FACTOR,
  snapshot = psSnapshot,
} = {}) {
  // os.loadavg() is [0, 0, 0] on Windows, which never crosses the threshold.
  if (!(cpus > 0) || !(load >= factor * cpus)) return null;
  return {
    load1: Math.round(load * 10) / 10,
    cpus,
    busiest: busiestCommands(psOutput ?? snapshot()),
  };
}

export function describeBusiest(busiest) {
  return (
    busiest
      .map(
        ({ command, processes, cpuPercent }) =>
          `${command}${processes === 1 ? '' : ` ×${processes}`} (${cpuPercent}% CPU)`,
      )
      .join(', ') || 'unknown (ps unavailable)'
  );
}

export function hostLoadWarning(report, label) {
  return (
    `[${label}] WARNING: host load is ${report.load1} on ${report.cpus} CPUs ` +
    `(${(report.load1 / report.cpus).toFixed(1)}x); busiest commands: ${describeBusiest(report.busiest)}. ` +
    'Other workspaces share this host, so timeouts in this run may come from that load rather ' +
    'than the code under test; rerun when the host is quieter before treating them as real failures.'
  );
}

/** The one-line reminder printed after a failed run that started on a busy host. */
export function hostLoadReminder(report, label) {
  return (
    `[${label}] NOTE: host load was ${report.load1} on ${report.cpus} CPUs when this run started ` +
    `(busiest: ${describeBusiest(report.busiest)}); timeouts above may be co-tenant load.`
  );
}
