/**
 * Process-tree helpers shared by the macOS packaging hang guards
 * (scripts/bounded-exec.mjs, scripts/run-until-notarizing.mjs).
 *
 * `ps -A -o pid=,ppid=,pgid=,etime=,stat=,command=` is understood by both macOS
 * (BSD ps) and Linux (procps), so the same code runs on the release runners and
 * in the unit tests.
 */
import { spawnSync } from 'node:child_process';

const PS_ARGS = ['-A', '-o', 'pid=,ppid=,pgid=,etime=,stat=,command='];

/** @returns {{pid:number, ppid:number, pgid:number, etime:string, stat:string, command:string}[]} */
export function parseProcessList(text) {
  const processes = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);
    if (!match) continue;
    processes.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      etime: match[4],
      stat: match[5],
      command: match[6] ?? '',
    });
  }
  return processes;
}

/** Snapshot of every process on the host; empty when `ps` is unavailable or hangs. */
export function listProcesses({ timeoutMs = 10_000 } = {}) {
  const result = spawnSync('ps', PS_ARGS, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return [];
  return parseProcessList(result.stdout);
}

/** `rootPid` and every process below it, parents before children. */
export function descendantsOf(rootPid, processes) {
  const children = new Map();
  for (const proc of processes) {
    if (!children.has(proc.ppid)) children.set(proc.ppid, []);
    children.get(proc.ppid).push(proc);
  }
  const root = processes.find((proc) => proc.pid === rootPid);
  const out = root ? [root] : [];
  const queue = [rootPid];
  const seen = new Set(queue);
  while (queue.length) {
    for (const child of children.get(queue.shift()) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      out.push(child);
      queue.push(child.pid);
    }
  }
  return out;
}

// Flags whose next argument is a secret (security import -P, create-keychain -p,
// notarytool --password, codesign helpers). GitHub masks registered secrets, but
// derived values (an electron-builder temp-keychain password) are not registered.
const SECRET_FLAGS = new Set(['-P', '-p', '--password', '--key-password', '--keychain-password']);
const SECRET_ASSIGNMENT = /\b([A-Za-z_]*(?:PASSWORD|PWD|SECRET|TOKEN|CERTIFICATE)[A-Za-z_]*)=\S+/gi;

export function redactCommand(command) {
  const words = command.split(' ');
  for (let i = 0; i < words.length - 1; i++) {
    if (SECRET_FLAGS.has(words[i])) words[i + 1] = '<redacted>';
  }
  return words
    .join(' ')
    .replace(/(--password=)\S+/g, '$1<redacted>')
    .replace(SECRET_ASSIGNMENT, '$1=<redacted>');
}

/**
 * Human-readable tree of `rootPid`'s descendants plus any other members of its
 * process group (a child that was reparented after its parent exited), one line
 * per process with elapsed time and state, secrets redacted.
 */
export function formatProcessTree(rootPid, processes, { maxCommandLength = 400 } = {}) {
  const tree = descendantsOf(rootPid, processes);
  const inTree = new Set(tree.map((proc) => proc.pid));
  const strays = processes.filter((proc) => proc.pgid === rootPid && !inTree.has(proc.pid));
  const depth = new Map([[rootPid, 0]]);
  const line = (proc, level) => {
    let command = redactCommand(proc.command);
    if (command.length > maxCommandLength) command = `${command.slice(0, maxCommandLength)}…`;
    return `${'  '.repeat(level)}${proc.pid} (ppid ${proc.ppid}, pgid ${proc.pgid}, ${proc.etime}, ${proc.stat}) ${command}`;
  };
  const lines = tree.map((proc) => {
    const level = proc.pid === rootPid ? 0 : (depth.get(proc.ppid) ?? 0) + 1;
    depth.set(proc.pid, level);
    return line(proc, level);
  });
  for (const proc of strays) lines.push(`${line(proc, 0)} [same process group, reparented]`);
  return lines;
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function signal(pid, name) {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone.
  }
}
