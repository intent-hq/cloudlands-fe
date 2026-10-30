// @verify-changed-triggers: scripts/verify-isolated-macos-package.mjs
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPackageProbe } from './isolated-package-probe.mjs';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'isolated-probe-'));
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(directory, { recursive: true, force: true });
});
const read = () => JSON.parse(readFileSync(path.join(directory, 'isolation.json'), 'utf8'));

it('persists the phase before a hung package call and fails within its deadline', async () => {
  const probe = createPackageProbe(directory, { passed: false, phases: [] });
  const result = probe.run('private startup', () => new Promise(() => {}), 100);
  const rejected = expect(result).rejects.toThrow('private startup exceeded 100ms');
  expect(read().probe).toMatchObject({ label: 'private startup', state: 'started' });
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  expect(read()).toMatchObject({
    passed: false,
    probe: { state: 'failed' },
    probeFailure: { label: 'private startup' },
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('returns actual results and removes the deadline after successful completion', async () => {
  const probe = createPackageProbe(directory, { passed: false });
  expect(await probe.run('inspection', async () => ({ backend: 'selected' }), 100)).toEqual({
    backend: 'selected',
  });
  expect(read()).toMatchObject({ passed: false, probe: { state: 'completed' } });
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the original assertion failure even if cleanup also fails', async () => {
  const probe = createPackageProbe(directory, { passed: false });
  const original = new Error('wrong private socket');
  await expect(
    probe.run('inspection', () => {
      throw original;
    }),
  ).rejects.toBe(original);
  await expect(
    probe.run('cleanup', async () => {
      throw new Error('cleanup failed');
    }),
  ).rejects.toThrow('cleanup failed');
  expect(read().probeFailure).toMatchObject({
    label: 'inspection',
    error: expect.stringContaining('wrong private socket'),
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('does not turn a late success into passing evidence after timeout', async () => {
  const probe = createPackageProbe(directory, { passed: false });
  let finish!: (value: boolean) => void;
  const result = probe.run(
    'inspection',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    100,
  );
  const rejected = expect(result).rejects.toThrow('exceeded');
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  finish(true);
  await Promise.resolve();
  expect(read()).toMatchObject({ passed: false, probe: { state: 'failed' } });
});

it('keeps successful main checks incomplete until cleanup and terminal persistence finish', async () => {
  const evidence = { passed: false };
  const probe = createPackageProbe(directory, evidence);
  evidence.passed = true;
  probe.persist();
  expect(read()).toMatchObject({ passed: false, completed: false });
  let close!: () => void;
  const cleanup = probe.run(
    'final cleanup',
    () =>
      new Promise<void>((resolve) => {
        close = resolve;
      }),
  );
  await Promise.resolve();
  expect(read()).toMatchObject({ passed: false, completed: false });
  close();
  await cleanup;
  expect(read()).toMatchObject({ passed: false, completed: false });
  probe.finish();
  expect(read()).toMatchObject({ passed: true, completed: true });
});

it('persists terminal failure when cleanup fails after successful main checks', async () => {
  const evidence = { passed: false };
  const probe = createPackageProbe(directory, evidence);
  evidence.passed = true;
  const cleanup = probe.run('final cleanup', () => new Promise(() => {}), 100);
  const rejected = expect(cleanup).rejects.toThrow('exceeded');
  expect(read().passed).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  evidence.passed = false;
  probe.finish();
  expect(read()).toMatchObject({ passed: false, completed: true });
});

it('never persists passing evidence when final cleanup rejects immediately', async () => {
  const evidence = { passed: false };
  const probe = createPackageProbe(directory, evidence);
  evidence.passed = true;
  await expect(
    probe.run('final cleanup', async () => {
      throw new Error('sentinel close failed');
    }),
  ).rejects.toThrow('sentinel close failed');
  expect(read()).toMatchObject({ passed: false, completed: false });
  evidence.passed = false;
  probe.finish();
  expect(read()).toMatchObject({ passed: false, completed: true });
});
