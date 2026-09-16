/**
 * Regression guard for the `activate`-before-boot startup race: macOS fires
 * `app.on('activate')` on first launch, and an unguarded handler created a
 * window before the boot flow had registered the backend IPC handlers
 * (`connections:list` → "No handler registered") and before boot created its
 * own windows (duplicates). See `../app-activate.ts` and the companion guard
 * for the deferred-block variant in `./ipc-startup-race.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import { createBootWindowsGate, handleActivate, type ActivateDeps } from '../app-activate';

interface FakeWindow {
  id: string;
  destroyed: boolean;
  isDestroyed(): boolean;
}

function fakeWindow(id: string, destroyed = false): FakeWindow {
  return { id, destroyed, isDestroyed: () => destroyed };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeHarness(options: { restored?: boolean; backendId?: string } = {}) {
  const gate = createBootWindowsGate();
  const windows: FakeWindow[] = [];
  let mainWindow: FakeWindow | null = null;
  const deps: ActivateDeps<FakeWindow> = {
    whenBootWindowsReady: () => gate.ready,
    getAllWindows: () => windows,
    getMainWindow: () => mainWindow,
    focusWindow: vi.fn(),
    getActiveId: vi.fn(async () => options.backendId ?? 'local'),
    restoreSessions: vi.fn(async () => options.restored ?? false),
    createWindow: vi.fn((backendId: string) => {
      windows.push(fakeWindow(`created:${backendId}`));
    }),
  };
  return {
    gate,
    deps,
    windows,
    setMainWindow(window: FakeWindow | null) {
      mainWindow = window;
    },
  };
}

describe('handleActivate', () => {
  it('does not create a window before boot; focuses the boot window once boot releases the gate', async () => {
    const h = makeHarness();

    const activation = handleActivate(h.deps);
    await flushMicrotasks();

    expect(h.deps.restoreSessions).not.toHaveBeenCalled();
    expect(h.deps.createWindow).not.toHaveBeenCalled();
    expect(h.windows).toHaveLength(0);

    // Boot creates its window, then releases the gate.
    const bootWindow = fakeWindow('boot');
    h.windows.push(bootWindow);
    h.setMainWindow(bootWindow);
    h.gate.release();

    await expect(activation).resolves.toBe('focused');
    expect(h.deps.focusWindow).toHaveBeenCalledTimes(1);
    expect(h.deps.focusWindow).toHaveBeenCalledWith(bootWindow);
    expect(h.deps.restoreSessions).not.toHaveBeenCalled();
    expect(h.deps.createWindow).not.toHaveBeenCalled();
    expect(h.windows).toHaveLength(1);
  });

  it('after boot with zero live windows, restores saved sessions instead of creating a window', async () => {
    const h = makeHarness({ restored: true, backendId: 'remote-1' });
    h.gate.release();

    await expect(handleActivate(h.deps)).resolves.toBe('restored');
    expect(h.deps.restoreSessions).toHaveBeenCalledWith('remote-1');
    expect(h.deps.createWindow).not.toHaveBeenCalled();
    expect(h.deps.focusWindow).not.toHaveBeenCalled();
  });

  it('after boot with zero live windows and nothing to restore, creates a window on the active backend', async () => {
    const h = makeHarness({ restored: false, backendId: 'remote-2' });
    h.gate.release();
    // A destroyed window must not count as live.
    h.windows.push(fakeWindow('closed', true));

    await expect(handleActivate(h.deps)).resolves.toBe('created');
    expect(h.deps.restoreSessions).toHaveBeenCalledWith('remote-2');
    expect(h.deps.createWindow).toHaveBeenCalledWith('remote-2');
    expect(h.deps.focusWindow).not.toHaveBeenCalled();
  });

  it('focuses the first live window when the main window is gone', async () => {
    const h = makeHarness();
    h.gate.release();
    const stale = fakeWindow('main', true);
    const live = fakeWindow('other');
    h.windows.push(stale, live);
    h.setMainWindow(stale);

    await expect(handleActivate(h.deps)).resolves.toBe('focused');
    expect(h.deps.focusWindow).toHaveBeenCalledWith(live);
  });

  it('is released when the boot flow fails before creating windows', async () => {
    const h = makeHarness({ restored: false });
    const activation = handleActivate(h.deps);
    await flushMicrotasks();
    expect(h.deps.createWindow).not.toHaveBeenCalled();

    const boot = Promise.reject(new Error('sidecar failed')).finally(() => h.gate.release());
    await expect(boot).rejects.toThrow('sidecar failed');

    await expect(activation).resolves.toBe('created');
    expect(h.deps.createWindow).toHaveBeenCalledTimes(1);
  });

  it('awaits an async createWindow dep: resolves "created" only after the window creator settles', async () => {
    // The production creators are async (they await the renderer-window gate
    // in ./renderer-window-gate.ts); handleActivate must not report 'created'
    // before that promise resolves.
    const h = makeHarness({ restored: false, backendId: 'remote-4' });
    h.gate.release();
    let finishCreate!: () => void;
    const creating = new Promise<void>((resolve) => (finishCreate = resolve));
    vi.mocked(h.deps.createWindow).mockImplementationOnce(async (backendId: string) => {
      await creating;
      h.windows.push(fakeWindow(`created:${backendId}`));
    });

    let settled = false;
    const activation = handleActivate(h.deps).then((outcome) => {
      settled = true;
      return outcome;
    });
    await flushMicrotasks();

    expect(h.deps.createWindow).toHaveBeenCalledWith('remote-4');
    expect(settled).toBe(false);
    expect(h.windows).toHaveLength(0);

    finishCreate();
    await expect(activation).resolves.toBe('created');
    expect(settled).toBe(true);
    expect(h.windows).toHaveLength(1);
  });

  it('release is idempotent and keeps later activations unblocked', async () => {
    const h = makeHarness({ restored: false });
    h.gate.release();
    h.gate.release();

    await expect(handleActivate(h.deps)).resolves.toBe('created');
    await expect(handleActivate(h.deps)).resolves.toBe('focused');
    expect(h.deps.createWindow).toHaveBeenCalledTimes(1);
  });

  it('concurrent post-boot activations with zero windows create exactly one window', async () => {
    const h = makeHarness({ restored: false, backendId: 'remote-3' });
    h.gate.release();

    // Every activation passes the gate and observes zero windows before the
    // first one has finished awaiting getActiveId()/restoreSessions().
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => handleActivate(h.deps)));

    expect(outcomes).toEqual(['created', 'created', 'created', 'created', 'created']);
    expect(h.deps.getActiveId).toHaveBeenCalledTimes(1);
    expect(h.deps.restoreSessions).toHaveBeenCalledTimes(1);
    expect(h.deps.createWindow).toHaveBeenCalledTimes(1);
    expect(h.deps.createWindow).toHaveBeenCalledWith('remote-3');
    expect(h.windows).toHaveLength(1);

    // Once settled, a later activation sees the created window and focuses it.
    await expect(handleActivate(h.deps)).resolves.toBe('focused');
    expect(h.deps.createWindow).toHaveBeenCalledTimes(1);
  });

  it('a failed restore rejects every concurrent activation and does not wedge later ones', async () => {
    const h = makeHarness({ restored: false });
    h.gate.release();
    vi.mocked(h.deps.restoreSessions).mockRejectedValueOnce(new Error('session store unreadable'));

    const results = await Promise.allSettled([handleActivate(h.deps), handleActivate(h.deps)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(h.deps.restoreSessions).toHaveBeenCalledTimes(1);
    expect(h.deps.createWindow).not.toHaveBeenCalled();

    await expect(handleActivate(h.deps)).resolves.toBe('created');
    expect(h.deps.restoreSessions).toHaveBeenCalledTimes(2);
    expect(h.deps.createWindow).toHaveBeenCalledTimes(1);
  });
});
