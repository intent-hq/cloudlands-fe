/**
 * Renderer hang monitor (main process).
 *
 * Listens for the BrowserWindow `unresponsive` / `responsive` events on every
 * main window (attached from `app.on('browser-window-created')` in
 * `src/main/index.ts`). When a renderer stops responding:
 *
 * 1. Log at error level with window context — window id, backend id, the
 *    last-known workspace id (main tracks it via WINDOW.SET_IN_WORKSPACE), and
 *    the time since the window was last known responsive.
 * 2. Best-effort JS stack capture: attach `webContents.debugger`, `Debugger.enable`
 *    + `Debugger.pause`, log the `callFrames` from `Debugger.paused`, then
 *    `Debugger.resume` and detach. The whole attempt, cleanup included, is
 *    bounded by one deadline and fully swallowed — it can never throw or delay
 *    the dialog. Skipped when DevTools is open or a debugger is already
 *    attached, since pausing would hijack the developer's session.
 * 3. Show a native Reload / Wait dialog. At most one dialog per unresponsive
 *    episode; the dialog is aborted (treated as Wait) when `responsive` fires
 *    first or the window closes. Reload uses `webContents.reload()` — never
 *    `forcefullyCrashRenderer()`.
 *
 * All listeners are removed on `closed` so nothing leaks per window.
 */
import {
  dialog,
  type BrowserWindow,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from 'electron';

import { Logger } from '../shared/logger';
import { m } from '../shared/paraglide/messages.js';
import { getBackendIdForWindow } from './window-backend';

const logger = new Logger('RendererHangMonitor');

/** Upper bound on the whole stack-capture attempt (attach → paused → detach). */
const STACK_CAPTURE_TIMEOUT_MS = 3000;
/** Maximum call frames included in the log line. */
const MAX_LOGGED_FRAMES = 30;

/** One logged JS frame from the stuck renderer thread. */
export interface RendererHangFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

/** Structured context logged for every unresponsive event. */
interface RendererHangLogPayload {
  windowId: number;
  backendId: string;
  workspaceId: string | undefined;
  /** Milliseconds since the window was last known responsive (or attached). */
  msSinceResponsive: number;
  url: string;
}

/** Dependency seams for tests; production uses the defaults. */
export interface RendererHangMonitorDeps {
  resolveWorkspaceId(windowId: number): Promise<string | undefined>;
  captureStack(window: BrowserWindow): Promise<RendererHangFrame[] | null>;
  showMessageBox(parent: BrowserWindow, options: MessageBoxOptions): Promise<MessageBoxReturnValue>;
  now(): number;
}

/**
 * Lazy import keeps this module dependency-light — system.ipc registers
 * ipcMain handlers on load, which real main already did.
 */
async function defaultResolveWorkspaceId(windowId: number): Promise<string | undefined> {
  const { getWorkspaceIdForWindow } = await import('../features/system/main/system.ipc');
  return getWorkspaceIdForWindow(windowId);
}

interface DebuggerPausedParams {
  callFrames?: Array<{
    functionName?: string;
    url?: string;
    location?: { scriptId?: string; lineNumber?: number; columnNumber?: number };
  }>;
}

/** Shape the CDP `Debugger.paused` payload into loggable frames. */
function framesFromPaused(params: DebuggerPausedParams): RendererHangFrame[] {
  return (params.callFrames ?? []).slice(0, MAX_LOGGED_FRAMES).map((frame) => ({
    functionName: frame.functionName || '(anonymous)',
    url: frame.url ?? '',
    lineNumber: (frame.location?.lineNumber ?? -1) + 1,
    columnNumber: (frame.location?.columnNumber ?? -1) + 1,
  }));
}

type DebuggerMessageListener = (event: Electron.Event, method: string, params: unknown) => void;

/**
 * Pause the renderer's JS thread over CDP and read its call stack. Returns
 * null when DevTools is open or a debugger is already attached, or when the
 * attempt does not finish within `timeoutMs`.
 *
 * Every CDP command can stall on a wedged renderer, so the deadline races the
 * whole attempt rather than any single step, and the continuation checks the
 * deadline after each await so a late reply never issues another command.
 * Cleanup is synchronous and unconditional: the listener is removed and the
 * debugger detached (which also resumes a paused renderer), so nothing is left
 * attached even if the graceful resume/disable never settle. Callers wrap this
 * in try/catch.
 */
export async function captureRendererStack(
  window: BrowserWindow,
  timeoutMs: number = STACK_CAPTURE_TIMEOUT_MS,
): Promise<RendererHangFrame[] | null> {
  const contents = window.webContents;
  const dbg = contents.debugger;
  if (contents.isDevToolsOpened() || dbg.isAttached()) return null;

  let expired = false;
  let onMessage: DebuggerMessageListener | null = null;

  const attempt = (async (): Promise<RendererHangFrame[] | null> => {
    dbg.attach('1.3');
    const paused = new Promise<RendererHangFrame[]>((resolve) => {
      onMessage = (_event, method, params) => {
        if (method === 'Debugger.paused') resolve(framesFromPaused(params as DebuggerPausedParams));
      };
      dbg.on('message', onMessage);
    });
    await dbg.sendCommand('Debugger.enable');
    if (expired) return null;
    await dbg.sendCommand('Debugger.pause');
    if (expired) return null;
    const frames = await paused;
    if (expired) return null;
    await dbg.sendCommand('Debugger.resume');
    if (expired) return null;
    await dbg.sendCommand('Debugger.disable');
    return frames;
  })();
  // The race may settle first; keep a late rejection from being unhandled.
  attempt.catch(() => undefined);

  let timer: NodeJS.Timeout | null = null;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve(null);
    }, timeoutMs);
  });

  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    expired = true;
    if (timer) clearTimeout(timer);
    if (onMessage) dbg.removeListener('message', onMessage);
    try {
      if (dbg.isAttached()) dbg.detach();
    } catch {
      // Detach is best-effort; the renderer may already be gone.
    }
  }
}

function defaultShowMessageBox(
  parent: BrowserWindow,
  options: MessageBoxOptions,
): Promise<MessageBoxReturnValue> {
  return dialog.showMessageBox(parent, options);
}

/** Button order in the hang dialog: index 0 reloads, index 1 waits. */
const RELOAD_BUTTON = 0;
const WAIT_BUTTON = 1;

function buildHangDialogOptions(
  workspaceId: string | undefined,
  signal: AbortSignal,
): MessageBoxOptions {
  return {
    type: 'warning',
    title: m.renderer_hang_dialog_title(),
    message: m.renderer_hang_dialog_message(),
    detail: workspaceId
      ? m.renderer_hang_dialog_detail_workspace({ workspaceId })
      : m.renderer_hang_dialog_detail(),
    buttons: [m.renderer_hang_dialog_reload_button(), m.renderer_hang_dialog_wait_button()],
    defaultId: WAIT_BUTTON,
    cancelId: WAIT_BUTTON,
    noLink: true,
    signal,
  };
}

function formatFrame(frame: RendererHangFrame): string {
  return `${frame.functionName} (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Attach the hang monitor to `window`. The shared `browser-window-created`
 * hook calls this exactly once per window.
 */
export function attachRendererHangMonitor(
  window: BrowserWindow,
  overrides: Partial<RendererHangMonitorDeps> = {},
): void {
  const deps: RendererHangMonitorDeps = {
    resolveWorkspaceId: defaultResolveWorkspaceId,
    captureStack: captureRendererStack,
    showMessageBox: defaultShowMessageBox,
    now: Date.now,
    ...overrides,
  };
  const contents = window.webContents;
  const windowId = window.id;
  let lastResponsiveAt = deps.now();
  /** Non-null while an unresponsive episode is in progress (dialog pending or shown). */
  let episode: AbortController | null = null;
  /** When the current episode's `unresponsive` event fired. */
  let episodeStartedAt = 0;

  const isGone = () => window.isDestroyed() || contents.isDestroyed();

  const handleUnresponsive = async (abort: AbortController): Promise<void> => {
    const unresponsiveAt = deps.now();
    const backendId = getBackendIdForWindow(window);
    let workspaceId: string | undefined;
    try {
      workspaceId = await deps.resolveWorkspaceId(windowId);
    } catch (error) {
      logger.warn('Failed to resolve workspace for unresponsive window', {
        windowId,
        error: errorMessage(error),
      });
    }
    const payload: RendererHangLogPayload = {
      windowId,
      backendId,
      workspaceId,
      msSinceResponsive: unresponsiveAt - lastResponsiveAt,
      url: isGone() ? '' : contents.getURL(),
    };
    logger.error('Renderer unresponsive', payload);
    if (abort.signal.aborted || isGone()) return;

    let frames: RendererHangFrame[] | null = null;
    try {
      frames = await deps.captureStack(window);
    } catch (error) {
      logger.warn('Renderer hang stack capture failed', { windowId, error: errorMessage(error) });
    }
    if (frames && frames.length > 0) {
      logger.error('Renderer hang stack', { windowId, frames: frames.map(formatFrame) });
    } else {
      logger.warn('Renderer hang stack unavailable', { windowId });
    }
    if (abort.signal.aborted || isGone()) return;

    const { response } = await deps.showMessageBox(
      window,
      buildHangDialogOptions(workspaceId, abort.signal),
    );
    if (abort.signal.aborted || isGone()) return;
    if (response === RELOAD_BUTTON) {
      logger.info('Reloading unresponsive renderer', { windowId });
      // A reload starts a fresh renderer; let a later hang open a new dialog
      // even if `responsive` never fires for the old one.
      if (episode === abort) episode = null;
      contents.reload();
    } else {
      logger.info('User chose to wait for unresponsive renderer', { windowId });
    }
  };

  const onUnresponsive = () => {
    if (episode) return;
    const abort = new AbortController();
    episode = abort;
    episodeStartedAt = deps.now();
    void handleUnresponsive(abort).catch((error: unknown) => {
      logger.warn('Renderer hang handling failed', { windowId, error: errorMessage(error) });
    });
  };

  const onResponsive = () => {
    const now = deps.now();
    if (episode) {
      logger.info('Renderer responsive again', {
        windowId,
        msUnresponsive: now - episodeStartedAt,
      });
      episode.abort();
      episode = null;
    }
    lastResponsiveAt = now;
  };

  const onClosed = () => {
    episode?.abort();
    episode = null;
    contents.removeListener('unresponsive', onUnresponsive);
    contents.removeListener('responsive', onResponsive);
  };

  contents.on('unresponsive', onUnresponsive);
  contents.on('responsive', onResponsive);
  window.once('closed', onClosed);
}
