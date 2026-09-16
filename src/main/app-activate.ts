/**
 * `app.on('activate')` decision logic, gated on the boot flow's window creation.
 *
 * macOS emits `activate` on first launch and on dock clicks. The boot flow in
 * `src/main/index.ts` awaits several slow steps (sidecar start, settings
 * services) before it registers the backend IPC handlers and creates its own
 * windows. An `activate` that arrives during that wait must not create a
 * window itself: the renderer would boot before handlers such as
 * `connections:list` exist ("No handler registered"), and boot would later
 * create its windows on top of it (duplicates).
 *
 * This is the second variant of the startup race guarded by
 * `src/main/__tests__/ipc-startup-race.test.ts` (critical vs. deferred IPC
 * registration); here the fix is sequencing rather than placement.
 *
 * `handleActivate` waits for the boot gate, then re-evaluates the live window
 * set: focus an existing window when there is one; otherwise (a post-boot dock
 * click with every window closed) restore saved sessions or create a window.
 * The zero-window branch is single-flight: it awaits `getActiveId()` and
 * `restoreSessions()` before any window exists, so concurrent activations that
 * all observed zero windows share one restore/create instead of each creating
 * a window.
 */

export interface ActivateWindow {
  isDestroyed(): boolean;
}

export interface BootWindowsGate {
  /** Resolves once boot has finished creating its windows (or gave up). */
  readonly ready: Promise<void>;
  /** Idempotent: releases every current and future `handleActivate` waiter. */
  release(): void;
}

export function createBootWindowsGate(): BootWindowsGate {
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release: () => release() };
}

export interface ActivateDeps<W extends ActivateWindow> {
  whenBootWindowsReady: () => Promise<void>;
  getAllWindows: () => readonly W[];
  getMainWindow: () => W | null | undefined;
  focusWindow: (window: W) => void;
  getActiveId: () => Promise<string>;
  restoreSessions: (backendId: string) => Promise<boolean>;
  createWindow: (backendId: string) => void;
}

type ZeroWindowOutcome = 'restored' | 'created';

/** The in-flight zero-window restore/create shared by concurrent activations. */
let pendingZeroWindowActivation: Promise<ZeroWindowOutcome> | null = null;

export async function handleActivate<W extends ActivateWindow>(
  deps: ActivateDeps<W>,
): Promise<'focused' | ZeroWindowOutcome> {
  await deps.whenBootWindowsReady();

  const liveWindows = deps.getAllWindows().filter((w) => !w.isDestroyed());
  if (liveWindows.length > 0) {
    // Focus an existing window instead of creating a new one.
    const mainWindow = deps.getMainWindow();
    const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : liveWindows[0];
    deps.focusWindow(target);
    return 'focused';
  }

  // No windows at all — single-flight the restore/create so activations that
  // race past the gate together do not each create a window.
  if (!pendingZeroWindowActivation) {
    pendingZeroWindowActivation = restoreOrCreateWindow(deps).finally(() => {
      pendingZeroWindowActivation = null;
    });
  }
  return pendingZeroWindowActivation;
}

// Restore every backend's saved sessions (same multi-bucket restore as boot)
// or create a new window. The active backend restores first and provides the
// main window, so a dock-click reopen never keys everything to the hard-coded
// local default.
async function restoreOrCreateWindow<W extends ActivateWindow>(
  deps: ActivateDeps<W>,
): Promise<ZeroWindowOutcome> {
  const backendId = await deps.getActiveId();
  if (await deps.restoreSessions(backendId)) {
    return 'restored';
  }
  deps.createWindow(backendId);
  return 'created';
}
