import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { get } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import type { CustomView } from '../../../shared/types/custom-views';

/** Do not leak Electron's Node runtime or injected preload flags into user commands. */
export function customViewEnvironment(port: number, source = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (/^(ELECTRON_|NODE_OPTIONS$|NODE_PATH$|VSCODE_INSPECTOR_OPTIONS$)/i.test(key))
      delete env[key];
  }
  return { ...env, PORT: String(port), HOST: '127.0.0.1' };
}

export function spawnCustomView(view: CustomView): ChildProcess {
  return spawn(view.command, {
    cwd: view.directory,
    env: customViewEnvironment(view.port),
    shell: true,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Probe both loopback families, including wildcard listeners, before spawning. */
export async function isCustomViewPortAvailable(port: number): Promise<boolean> {
  for (const host of ['127.0.0.1', '::1']) {
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once('error', (error: NodeJS.ErrnoException) => {
        resolve(host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code ?? ''));
      });
      server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
    });
    if (!free) return false;
  }
  return true;
}

/** Readiness is HTTP, not just an open TCP socket. Never follow redirects. */
export function probeCustomView(url: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const request = get(url, { signal, agent: false });
    const timeout = setTimeout(() => request.destroy(), 1000);
    const finish = (ready: boolean) => {
      clearTimeout(timeout);
      request.destroy();
      resolve(ready);
    };
    request.once('response', (response) => {
      response.destroy();
      finish(true);
    });
    request.once('error', () => finish(false));
    request.once('close', () => finish(false));
  });
}

/** Kill the owned process group, including children left behind by an exited shell. */
export async function stopCustomViewProcess(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      execFile(
        'taskkill',
        ['/pid', String(pid), '/T', '/F'],
        { windowsHide: true, timeout: 2000 },
        (error) => {
          // taskkill reports an error when the process already exited.
          if (error && child.exitCode === null && child.signalCode === null) reject(error);
          else resolve();
        },
      );
    });
    return;
  }
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  signalGroup('SIGTERM');
  // The shell's exit does not prove its children stopped. Always escalate the group.
  await delay(500);
  signalGroup('SIGKILL');
}
