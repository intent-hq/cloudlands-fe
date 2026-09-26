// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { Component } from 'svelte';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaptureStabilityTimeoutError, waitForCaptureStability } from './capture-stability';
import { defineGeometrySnapshotSuite } from './geometry-snapshot';

const { registerTest } = vi.hoisted(() => ({ registerTest: vi.fn() }));
const geometry = { probes: {}, root: { width: 420, height: 82 } };
let snapshotDir: string | undefined;

vi.mock('../../test/ct-test', () => ({ test: registerTest }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  registerTest.mockReset();
  if (snapshotDir) rmSync(snapshotDir, { recursive: true, force: true });
});

function startCapture(readinessTimeoutMs?: number) {
  vi.useFakeTimers();
  vi.stubEnv('SANDBOX_GEOMETRY_UPDATE', '0');
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
    window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => window.clearTimeout(id));

  const root = document.createElement('div');
  const collectGeometry = vi.fn(() => geometry);
  const unmount = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('__INTENT_GEOMETRY_CT__', { collectGeometry, waitForCaptureStability });
  snapshotDir = mkdtempSync(join(tmpdir(), 'geometry-readiness-'));
  const snapshotPath = join(snapshotDir, 'async-scene.geometry.json');
  writeFileSync(
    snapshotPath,
    JSON.stringify({ $meta: { generatedOn: 'linux' }, default: { 420: geometry } }),
  );

  defineGeometrySnapshotSuite({
    scene: 'async-scene',
    component: {} as Component,
    states: ['default'],
    widths: [420],
    captureReadiness: { selector: '[data-ready]', count: 1, readinessTimeoutMs },
    snapshotPath,
  });
  const fixtures = {
    mount: async () => ({ unmount }),
    page: {
      setViewportSize: async () => {},
      locator: () => ({
        evaluate: async <Argument, Result>(
          callback: (element: HTMLElement, argument: Argument) => Result,
          argument: Argument,
        ) => callback(root, argument),
      }),
    },
  };
  // Execute the registered suite with the real readiness helper; geometry is not
  // measured by jsdom. Its collection only records when the suite permits capture.
  const run = registerTest.mock.calls[0][1] as (value: typeof fixtures) => Promise<void>;
  const pending = run(fixtures).then(
    () => 'captured',
    (error: unknown) => error,
  );
  return { root, pending, collectGeometry, unmount };
}

it('waits for scene readiness beyond the default deadline before measuring geometry', async () => {
  const { root, pending, collectGeometry, unmount } = startCapture(10_000);
  await vi.advanceTimersByTimeAsync(6_000);
  expect(collectGeometry).not.toHaveBeenCalled();
  expect(unmount).not.toHaveBeenCalled();

  root.setAttribute('data-ready', '');
  await vi.advanceTimersByTimeAsync(2);
  await expect(pending).resolves.toBe('captured');
  expect(collectGeometry).toHaveBeenCalledOnce();
  expect(unmount).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the default readiness deadline when the scene omits a custom timeout', async () => {
  const { pending, collectGeometry, unmount } = startCapture();
  await vi.advanceTimersByTimeAsync(4_999);
  expect(collectGeometry).not.toHaveBeenCalled();
  expect(unmount).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).resolves.toEqual(new CaptureStabilityTimeoutError(5_000));
  expect(collectGeometry).not.toHaveBeenCalled();
  expect(unmount).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
