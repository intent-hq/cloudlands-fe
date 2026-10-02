import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import type { DesktopAction, DesktopDisplay } from '../../../shared/types/desktop';
import type { DesktopNative } from './desktop-executor';
import { desktopFailure } from './desktop-validation';
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

/** Private stdin/stdout protocol: never accept native operations directly from RPC.
 * One bounded OS step per request lets main invalidate between every down/up. */
export class DesktopHelperTransport {
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
          };
        };
        const pending = this.pending.get(reply.id);
        if (!pending) return;
        this.pending.delete(reply.id);
        clearTimeout(pending.timer);
        if (reply.error)
          pending.reject(
            desktopFailure(reply.error.code, reply.error.detail, reply.error.execution),
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

export class DesktopNativeAdapter implements DesktopNative {
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
    return z
      .array(displaySchema)
      .min(1)
      .parse(await this.request('layout'));
  }
  async capture(excludedWindows: string[], signal: AbortSignal) {
    signal.throwIfAborted();
    const result = z
      .array(displaySchema.extend({ data: z.string().min(1) }))
      .min(1)
      .parse(await this.request('capture', { excludedWindows }));
    signal.throwIfAborted();
    return result;
  }
  async input(
    action: DesktopAction,
    display: DesktopDisplay | undefined,
    check: (executed?: boolean) => void,
    signal: AbortSignal,
  ): Promise<void> {
    let completedInput = false;
    const step = async (operation: string, params: Record<string, unknown> = {}) => {
      signal.throwIfAborted();
      check();
      await this.request(operation, params);
      if (operation !== 'validateKey') completedInput = true;
      check(completedInput);
      signal.throwIfAborted();
    };
    // Native helpers perform the mapping against current display geometry again;
    // Mac image pixels -> per-display points, Windows -> physical virtual pixels.
    const move = (x: number, y: number) => step('move', { display, x, y });
    try {
      switch (action.kind) {
        case 'click':
          await move(action.x, action.y);
          for (let i = 1; i <= (action.clickCount ?? 1); i++) {
            await step('button', { button: action.button ?? 'left', down: true, clickCount: i });
            await step('button', { button: action.button ?? 'left', down: false, clickCount: i });
          }
          break;
        case 'drag':
          await move(action.from.x, action.from.y);
          await step('button', { button: 'left', down: true });
          for (let i = 1; i <= 20; i++)
            await move(
              action.from.x + ((action.to.x - action.from.x) * i) / 20,
              action.from.y + ((action.to.y - action.from.y) * i) / 20,
            );
          await step('button', { button: 'left', down: false });
          break;
        case 'scroll':
          await move(action.x, action.y);
          await step('scroll', { deltaX: action.deltaX, deltaY: action.deltaY });
          break;
        case 'type':
          for (const scalar of action.text) await step('text', { text: scalar });
          break;
        case 'keypress':
          // Validate mapping before holding any modifiers.
          await step('validateKey', { key: action.key });
          for (const key of action.modifiers ?? []) await step('key', { key, down: true });
          await step('key', { key: action.key, down: true });
          await step('key', { key: action.key, down: false });
          for (const key of [...(action.modifiers ?? [])].reverse())
            await step('key', { key, down: false });
          break;
        case 'screenshot':
          throw desktopFailure('invalid-params', 'Capture is not an input step', 'not_started');
      }
    } catch (error) {
      if (completedInput && error instanceof ReverseRpcHandlerError) {
        const data = error.data as { code: string; detail: string; execution?: string };
        if (data?.execution === 'not_started')
          throw desktopFailure(data.code, data.detail, 'partial');
      }
      throw error;
    } finally {
      // Release is cleanup, deliberately allowed after cancellation/deadline.
      await this.request('releaseInput');
    }
  }
}
