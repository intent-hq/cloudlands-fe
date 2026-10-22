import { spawn } from 'node:child_process';
import { readFile, readdir, readlink } from 'node:fs/promises';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
export async function identity(pid) {
  try {
    const s = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = s.slice(s.lastIndexOf(')') + 2).split(' ');
    return {
      pid,
      start: fields[19],
      parent: Number(fields[1]),
      state: fields[0],
      exe: await readlink(`/proc/${pid}/exe`).catch(() => null),
    };
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ESRCH') return null;
    throw e;
  }
}
export class Owned {
  constructor(record) {
    this.record = record;
    this.children = [];
    this.captured = new Map();
    this.wrapper = null;
  }
  async start(name, command, args, env, cwd) {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise((resolve) => {
      child.once('error', (e) => resolve({ error: e.message }));
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    await once(child, 'spawn');
    const id = await identity(child.pid);
    if (!id) throw new Error(`${name} exited before identity capture`);
    this.children.push({ child, id, exited, name });
    this.captured.set(`${id.pid}:${id.start}`, id);
    this.record({ kind: 'start', name, identity: id, argv: [command, ...args] });
    // No raw provider/daemon logs are published: retain hashes/counts, not credentials.
    for (const [stream, output] of [
      ['stdout', child.stdout],
      ['stderr', child.stderr],
    ])
      output.on('data', (b) =>
        this.record({
          kind: 'service-output',
          name,
          stream,
          bytes: b.length,
          sha256: createHash('sha256').update(b).digest('hex'),
        }),
      );
    return { child, id, exited };
  }
  async tree(pid) {
    const result = [],
      queue = [pid],
      seen = new Set();
    while (queue.length) {
      const next = queue.shift();
      if (seen.has(next)) continue;
      seen.add(next);
      if (seen.size > 1024) throw new Error('owned process bound');
      const id = await identity(next);
      if (!id) continue;
      result.push(id);
      this.captured.set(`${id.pid}:${id.start}`, id);
      for (const tid of await readdir(`/proc/${next}/task`)) {
        const text = await readFile(`/proc/${next}/task/${tid}/children`, 'utf8').catch((e) => {
          if (e.code === 'ENOENT') return '';
          throw e;
        });
        queue.push(...text.trim().split(/\s+/).filter(Boolean).map(Number));
      }
    }
    return result;
  }
  async proof(pid, expectedPorts) {
    this.wrapper ??= await identity(pid);
    if (!this.wrapper || this.wrapper.pid !== process.pid || this.wrapper.pid !== pid)
      throw new Error('collector wrapper ownership mismatch');
    const currentWrapper = await identity(pid);
    if (currentWrapper?.start !== this.wrapper.start) throw new Error('collector wrapper changed');
    const first = await this.tree(pid);
    const second = await this.tree(pid);
    if (!first.length || !second.length) throw new Error('empty owned-tree proof');
    const sockets = new Set();
    for (const id of second) {
      const now = await identity(id.pid);
      if (!now || now.start !== id.start) throw new Error('collector identity changed');
      for (const fd of await readdir(`/proc/${id.pid}/fd`)) {
        const link = await readlink(`/proc/${id.pid}/fd/${fd}`).catch((e) => {
          if (e.code === 'ENOENT') return '';
          throw e;
        });
        const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1];
        if (inode) sockets.add(inode);
      }
    }
    const listeners = [];
    for (const file of ['tcp', 'tcp6']) {
      for (const row of (await readFile(`/proc/net/${file}`, 'utf8')).trim().split('\n').slice(1)) {
        const fields = row.trim().split(/\s+/);
        if (fields[3] !== '0A') continue;
        const port = parseInt(fields[1].split(':')[1], 16);
        listeners.push({ family: file, address: fields[1], inode: fields[9], port });
        if (!expectedPorts.includes(port) || !sockets.has(fields[9]))
          throw new Error('unexpected or unowned listener');
      }
    }
    for (const port of expectedPorts)
      if (!listeners.some((l) => l.port === port)) throw new Error('missing listener');
    const receipt = { kind: 'owned-tree-listener-proof', first, second, listeners };
    this.record(receipt);
    return receipt;
  }
  async close() {
    const outcomes = [];
    for (const entry of [...this.children].reverse()) {
      const now = await identity(entry.id.pid);
      if (now && now.start !== entry.id.start) {
        outcomes.push({ name: entry.name, state: 'identity-mismatch-no-signal' });
        continue;
      }
      if (now) entry.child.kill('SIGTERM');
      const result = await Promise.race([
        entry.exited,
        new Promise((r) => setTimeout(() => r({ timeout: true }), 5000)),
      ]);
      if (result.timeout) {
        const live = await identity(entry.id.pid);
        if (live?.start === entry.id.start) entry.child.kill('SIGKILL');
        const killed = await Promise.race([
          entry.exited,
          new Promise((r) => setTimeout(() => r({ timeout: true }), 5000)),
        ]);
        outcomes.push({ name: entry.name, termination: result, afterKill: killed });
      } else {
        outcomes.push({ name: entry.name, ...result });
      }
    }
    const remaining = [];
    for (const captured of this.captured.values()) {
      // The collector is alive to write this receipt. Its terminal outcome and
      // absence belong to the outer container wait/remove receipt, not this check.
      if (captured.pid === this.wrapper?.pid && captured.start === this.wrapper.start) continue;
      const live = await identity(captured.pid);
      if (live?.start === captured.start) remaining.push(captured);
    }
    this.record({
      kind: 'process-release',
      outcomes,
      captured: [...this.captured.values()],
      remaining,
      wrapper: this.wrapper,
      wrapperAbsence: 'requires outer container terminal/removal receipt',
    });
    if (remaining.length)
      throw new Error('captured descendants remain; owned container removal required');
  }
}
