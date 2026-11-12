import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import type {
  DesktopAction,
  DesktopDisplay,
  DesktopOsChecklist,
  DesktopTargetMismatchReason,
} from '../../../shared/types/desktop';
import type { DesktopNative, DesktopTargetCheck } from './desktop-executor';
import { desktopFailure } from './desktop-validation';
import { nativeWindowStateSchema, type NativeWindowState } from './desktop-windows';
import { ReverseRpcHandlerError } from '../../backend/main/json-rpc-client';

const displaySchema = z
  .object({
    displayId: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    originX: z.number().int(),
    originY: z.number().int(),
    scaleFactor: z.number().finite().positive(),
  })
  .strict();
export type NativeRequest = (
  operation: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

function desktopHelperPath(): string {
  const name = process.platform === 'win32' ? 'intent-desktop-helper.exe' : 'intent-desktop-helper';
  return app.isPackaged
    ? join(process.resourcesPath, 'desktop-helper', name)
    : join(
        app.getAppPath(),
        'resources',
        'desktop-helper',
        `${process.platform}-${process.arch}`,
        name,
      );
}
export function desktopNativeAvailable(): boolean {
  return (
    (process.platform === 'darwin' || process.platform === 'win32') &&
    existsSync(desktopHelperPath())
  );
}

// Permission requests and execution share the same signed child and its lifetime.
let nativeAdapter: DesktopNativeAdapter | undefined;
export function getDesktopNativeAdapter(): DesktopNativeAdapter {
  return (nativeAdapter ??= new DesktopNativeAdapter(new DesktopHelperTransport().request));
}

/** Private stdin/stdout protocol: never accept native operations directly from RPC.
 * One bounded OS step per request lets main invalidate between every down/up. */
class DesktopHelperTransport {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  request: NativeRequest = async (operation, params = {}) => {
    if (!this.child) this.launch();
    const child = this.child;
    if (!child)
      throw desktopFailure(
        'desktop-unsupported',
        'Native desktop helper failed to launch',
        'not_started',
      );
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(), 9000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, operation, ...params }) + '\n', (error) => {
        if (error) this.fail();
      });
    });
  };
  private launch(): void {
    if (!desktopNativeAvailable())
      throw desktopFailure(
        'desktop-unsupported',
        'Native desktop helper is unavailable',
        'not_started',
      );
    const child = spawn(desktopHelperPath(), [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    // Never log helper output: it can contain screen images or typed text.
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        const reply = JSON.parse(line) as {
          id: number;
          result?: unknown;
          error?: {
            code: string;
            detail: string;
            execution?: 'not_started' | 'partial' | 'unknown';
            reason?: DesktopTargetMismatchReason;
          };
        };
        const pending = this.pending.get(reply.id);
        if (!pending) return;
        this.pending.delete(reply.id);
        clearTimeout(pending.timer);
        if (reply.error)
          pending.reject(
            desktopFailure(
              reply.error.code,
              reply.error.detail,
              reply.error.execution,
              reply.error.reason,
            ),
          );
        else pending.resolve(reply.result);
      } catch {
        this.fail();
      }
    });
    child.once('error', () => this.fail());
    child.once('exit', () => {
      if (this.child === child) this.fail();
    });
  }
  private fail(): void {
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) {
      // EOF gives a responsive helper its native finally/defer cleanup path.
      // Force termination only as a backstop for an unresponsive OS call.
      child.stdin.end();
      const kill = setTimeout(() => {
        if (child.exitCode === null) child.kill();
      }, 1000);
      kill.unref();
    }
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(
        desktopFailure(
          'desktop-outcome-unknown',
          'Native helper stopped responding; input will not be replayed',
          'unknown',
        ),
      );
    }
    this.pending.clear();
  }
}

const permissionObservation = z
  .object({
    accessibility: z.boolean(),
    screenRecording: z.boolean(),
    screenCapture: z.enum(['pending', 'ready', 'unavailable']),
  })
  .strict();
type PermissionObservation = z.infer<typeof permissionObservation>;
// The helper abandons a capture check that is not re-asked within 3 s.
const PERMISSION_RECHECK_MS = 500;
const PERMISSION_SETTLE_MS = 120_000;
const PERMISSION_HOLD_MS = 1500;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** `promise`, or undefined after `ms`; rejects with the reason once `signal` aborts. */
function within<T>(promise: Promise<T>, ms: number, signal?: AbortSignal) {
  return new Promise<T | undefined>((resolve, reject) => {
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      finish();
    };
    const abort = () => settle(() => reject(signal?.reason));
    const timer = Number.isFinite(ms)
      ? setTimeout(() => settle(() => resolve(undefined)), ms)
      : undefined;
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}
interface PermissionCheck {
  first: Promise<PermissionObservation>;
  latest?: PermissionObservation;
  result: Promise<DesktopOsChecklist>;
}

export class DesktopNativeAdapter implements DesktopNative {
  private readonly checks = new Map<string, PermissionCheck>();
  /** The only way to ask macOS for desktop permissions. The helper answers a new
   * request id with a "pending" capture check and settles it only when the same
   * id asks again within 3 s. Main owns that: one loop per id re-asks until the
   * answer is final, the deadline passes (default two minutes) or a re-ask is
   * refused (both end as unavailable). A call waits up to `holdMs` for the final
   * answer, else returns "checking"; asking again joins the same loop. A refused
   * first ask rejects; `signal` rejects this call with its reason. */
  async requestPermissions(
    computerId: string,
    requestId: string,
    {
      signal,
      deadline,
      holdMs = PERMISSION_HOLD_MS,
    }: { signal?: AbortSignal; deadline?: number; holdMs?: number } = {},
  ): Promise<DesktopOsChecklist> {
    signal?.throwIfAborted();
    const key = JSON.stringify([computerId, requestId]);
    let check = this.checks.get(key);
    if (!check) {
      check = this.startCheck(computerId, requestId, deadline ?? Date.now() + PERMISSION_SETTLE_MS);
      this.checks.set(key, check);
      void check.result.catch(() => undefined).finally(() => this.checks.delete(key));
    }
    await within(check.first, Infinity, signal);
    const final = await within(check.result, holdMs, signal);
    if (final) return final;
    const { accessibility, screenRecording } = check.latest ?? (await check.first);
    return { accessibility, screenRecording, screenCapture: 'checking' };
  }
  private startCheck(computerId: string, requestId: string, until: number): PermissionCheck {
    const first = this.askPermissions(computerId, requestId);
    const check: PermissionCheck = { first, result: first.then(settle) };
    const ask = () => this.askPermissions(computerId, requestId);
    async function settle(seen: PermissionObservation): Promise<DesktopOsChecklist> {
      while (true) {
        check.latest = seen;
        const { accessibility, screenRecording, screenCapture } = seen;
        if (!accessibility || !screenRecording)
          return { accessibility, screenRecording, screenCapture: 'blocked' };
        if (screenCapture !== 'pending') return { accessibility, screenRecording, screenCapture };
        const unavailable = {
          accessibility,
          screenRecording,
          screenCapture: 'unavailable' as const,
        };
        if (Date.now() + PERMISSION_RECHECK_MS > until) return unavailable;
        await delay(PERMISSION_RECHECK_MS);
        try {
          seen = await ask();
        } catch {
          return unavailable;
        }
      }
    }
    return check;
  }
  private async askPermissions(computerId: string, requestId: string) {
    return permissionObservation.parse(
      await this.request('requestPermissions', { computerId, requestId }),
    );
  }
  constructor(private readonly request: NativeRequest) {}
  async identity() {
    return z
      .object({
        computerId: z.string().min(1),
        computerName: z.string().min(1),
        platform: z.enum(['macos', 'windows']),
      })
      .strict()
      .parse(await this.request('identity'));
  }
  async acquire(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await this.request('acquire');
    if (signal.aborted) {
      await this.release();
      signal.throwIfAborted();
    }
  }
  async release(): Promise<void> {
    await this.request('release');
  }
  async check(): Promise<void> {
    await this.request('check');
  }
  async validateExclusion(excludedWindows: string[]): Promise<void> {
    await this.request('validateExclusion', { excludedWindows });
  }
  async layout(): Promise<DesktopDisplay[]> {
    return z.array(displaySchema).parse(await this.request('layout'));
  }
  /** Eligible windows front-to-back plus the frontmost app. With a display,
   * frames are in that display's image pixels; without one only identity,
   * ownership and z-order are meaningful. */
  async windows(
    excludedWindows: string[],
    display?: DesktopDisplay,
    layout?: DesktopDisplay[],
  ): Promise<NativeWindowState> {
    return nativeWindowStateSchema.parse(
      await this.request('windows', {
        excludedWindows,
        ...(display ? { display } : {}),
        ...(layout ? { layout } : {}),
      }),
    );
  }
  /** Frontmost app pid. Lock-free, so it also works after the session ended. */
  async frontmostPid(): Promise<number | undefined> {
    return z
      .object({ pid: z.number().int().positive().optional() })
      .strict()
      .parse(await this.request('frontmost')).pid;
  }
  /** Activates the owning app and raises the window. Never synthesizes input;
   * the caller verifies the outcome with a fresh `windows` snapshot. */
  async focusWindow(
    window: { handle: string; pid: number },
    excludedWindows: string[],
  ): Promise<void> {
    await this.request('focusWindow', { ...window, excludedWindows });
  }
  async capture(
    excludedWindows: string[],
    signal: AbortSignal,
    display: DesktopDisplay,
    layout: DesktopDisplay[],
  ) {
    signal.throwIfAborted();
    const result = z
      .array(displaySchema.extend({ data: z.string().min(1) }))
      .min(1)
      .parse(await this.request('capture', { excludedWindows, display, layout }));
    signal.throwIfAborted();
    return result;
  }
  async input(
    action: DesktopAction,
    display: DesktopDisplay | undefined,
    check: (executed?: boolean) => void,
    signal: AbortSignal,
    layout?: DesktopDisplay[],
    target?: DesktopTargetCheck,
  ): Promise<void> {
    let completedInput = false;
    // Window-target check (contract: before the first native input, before each
    // later typed scalar, before the keypress key-down and the drag press).
    const aim = async (point?: { x: number; y: number }) => {
      if (!target) return;
      signal.throwIfAborted();
      check(completedInput);
      await target(point);
      check(completedInput);
    };
    const step = async (operation: string, params: Record<string, unknown> = {}) => {
      signal.throwIfAborted();
      check();
      await this.request(operation, { ...params, ...(layout ? { layout } : {}) });
      if (operation !== 'validateKey') completedInput = true;
      check(completedInput);
      signal.throwIfAborted();
    };
    // Native helpers perform the mapping against current display geometry again;
    // Mac image pixels -> per-display points, Windows -> physical virtual pixels.
    const move = (x: number, y: number) => step('move', { display, x, y });
    try {
      switch (action.kind) {
        case 'move':
          await aim(action);
          await move(action.x, action.y);
          break;
        case 'click':
          await aim(action);
          await move(action.x, action.y);
          for (let i = 1; i <= (action.clickCount ?? 1); i++) {
            await step('button', { button: action.button ?? 'left', down: true, clickCount: i });
            await step('button', { button: action.button ?? 'left', down: false, clickCount: i });
          }
          break;
        case 'drag':
          await aim(action.from);
          await move(action.from.x, action.from.y);
          await aim(action.from);
          await step('button', { button: 'left', down: true });
          for (let i = 1; i <= 20; i++)
            await move(
              action.from.x + ((action.to.x - action.from.x) * i) / 20,
              action.from.y + ((action.to.y - action.from.y) * i) / 20,
            );
          await step('button', { button: 'left', down: false });
          break;
        case 'scroll':
          await aim(action);
          await move(action.x, action.y);
          await step('scroll', { deltaX: action.deltaX, deltaY: action.deltaY });
          break;
        case 'type':
          for (const scalar of action.text) {
            await aim();
            await step('text', { text: scalar });
          }
          break;
        case 'keypress':
          // Validate mapping before holding any modifiers.
          await step('validateKey', { key: action.key });
          await aim();
          for (const key of action.modifiers ?? []) await step('key', { key, down: true });
          if (action.modifiers?.length) await aim();
          await step('key', { key: action.key, down: true });
          await step('key', { key: action.key, down: false });
          for (const key of [...(action.modifiers ?? [])].reverse())
            await step('key', { key, down: false });
          break;
        case 'listDisplay':
        case 'screenshot':
        case 'focusWindow':
          throw desktopFailure('invalid-params', 'Capture is not an input step', 'not_started');
      }
    } catch (error) {
      if (completedInput && error instanceof ReverseRpcHandlerError) {
        const data = error.data as {
          code: string;
          detail: string;
          execution?: string;
          reason?: DesktopTargetMismatchReason;
        };
        if (data?.execution === 'not_started')
          throw desktopFailure(data.code, data.detail, 'partial', data.reason);
      }
      throw error;
    } finally {
      // Release is cleanup, deliberately allowed after cancellation/deadline.
      await this.request('releaseInput');
    }
  }
}
