import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { closeElectronApp } from './electron-app-close';

function idleProcess() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
}

async function reap(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

test('a close that never settles is bounded and kills the process', async () => {
  const child = idleProcess();
  try {
    const result = await closeElectronApp(
      { process: () => child, close: () => new Promise<void>(() => {}) },
      { timeoutMs: 200 },
    );
    expect(result).toBe('killed');
    expect(child.signalCode).toBe('SIGKILL');
  } finally {
    await reap(child);
  }
});

test('a rejected close still leaves no live process', async () => {
  const child = idleProcess();
  try {
    const result = await closeElectronApp(
      { process: () => child, close: () => Promise.reject(new Error('Target closed')) },
      { timeoutMs: 5_000 },
    );
    expect(result).toBe('killed');
    expect(child.signalCode).toBe('SIGKILL');
  } finally {
    await reap(child);
  }
});

test('a graceful close is reported as closed without a kill', async () => {
  const child = idleProcess();
  try {
    const result = await closeElectronApp(
      {
        process: () => child,
        close: async () => {
          child.kill('SIGTERM');
          await once(child, 'exit');
        },
      },
      { timeoutMs: 5_000 },
    );
    expect(result).toBe('closed');
    expect(child.signalCode).toBe('SIGTERM');
  } finally {
    await reap(child);
  }
});

test('closing an exited process again settles without a kill', async () => {
  const child = idleProcess();
  child.kill('SIGTERM');
  await once(child, 'exit');
  const result = await closeElectronApp(
    { process: () => child, close: () => Promise.resolve() },
    { timeoutMs: 5_000 },
  );
  expect(result).toBe('closed');
  expect(child.signalCode).toBe('SIGTERM');
});
