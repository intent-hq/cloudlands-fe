/**
 * Startup splash dismissal gating.
 *
 * The `#splash` element in `app.html` hides on Svelte mount today, before the
 * daemon connection is up — the first-rendered UI can fire probes against a
 * dead socket. This gates the dismissal on the backend actually being
 * reachable, with bounded fallbacks so the splash never outlives its budget:
 *
 * - Non-Electron (browser/test/mock) environments have no `window.electronAPI`
 *   bridge to a daemon, so they dismiss immediately — same as today.
 * - Electron: check the current status via `backend:get-status`, then listen
 *   for `BACKEND.STATUS` pushes. Dismiss as soon as status is `'connected'`.
 * - `sidecarStartupFailed` (reported by either the initial check or a status
 *   push) dismisses immediately so the daemon-loss / startup-failure UI is
 *   visible instead of stalling behind the splash.
 * - A bounded fallback timer (`timeoutMs`, default ~10s) dismisses
 *   unconditionally, so a daemon that never connects and never reports a
 *   startup failure can't leave an eternal splash.
 */
import { IPC_CHANNELS } from '$shared/ipc-registry';

const BACKEND = IPC_CHANNELS.BACKEND;

/** Bounded fallback so a dead/never-connecting daemon can't strand the splash. */
export const SPLASH_FALLBACK_TIMEOUT_MS = 10_000;

export interface SplashGateStatusPayload {
  status: string;
  sidecarStartupFailed?: boolean;
}

export interface StartSplashGateOptions {
  /** Overrides the auto-detected `window.electronAPI`; pass `null` to force the non-Electron path. */
  api?: Window['electronAPI'] | null;
  /** Overrides `SPLASH_FALLBACK_TIMEOUT_MS`. */
  timeoutMs?: number;
}

function shouldDismiss(payload: SplashGateStatusPayload | null | undefined): boolean {
  return !!payload && (payload.status === 'connected' || !!payload.sidecarStartupFailed);
}

/**
 * Start gating the splash's dismissal on backend connectivity.
 *
 * Calls `dismiss` at most once. Returns a cleanup function that removes the
 * status listener and clears the fallback timer — call it on unmount so a
 * late resolution/timer firing after teardown never calls `dismiss` again.
 */
export function startSplashGate(
  dismiss: () => void,
  options: StartSplashGateOptions = {},
): () => void {
  const api =
    options.api !== undefined
      ? options.api
      : typeof window !== 'undefined'
        ? window.electronAPI
        : undefined;
  const timeoutMs = options.timeoutMs ?? SPLASH_FALLBACK_TIMEOUT_MS;

  if (!api) {
    // Non-Electron (browser/test/mock) — dismiss immediately, as today.
    dismiss();
    return () => {};
  }
  const bridge = api;

  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let listenerId: string | null = null;

  const statusListener = (payload: SplashGateStatusPayload) => {
    if (shouldDismiss(payload)) finish();
  };

  function finish(): void {
    if (settled) return;
    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (listenerId) {
      bridge.offById(BACKEND.STATUS, listenerId);
      listenerId = null;
    }
    dismiss();
  }

  listenerId = bridge.on(BACKEND.STATUS, statusListener);
  timer = setTimeout(finish, timeoutMs);

  void bridge
    .invoke(BACKEND.GET_STATUS)
    .then((result: SplashGateStatusPayload) => {
      if (shouldDismiss(result)) finish();
    })
    .catch(() => {
      // Bridge not ready yet — the BACKEND.STATUS listener and fallback timer converge.
    });

  return () => {
    if (settled) return;
    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (listenerId) {
      bridge.offById(BACKEND.STATUS, listenerId);
      listenerId = null;
    }
  };
}
