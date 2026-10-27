import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  DesktopFrontmostApp,
  DesktopTargetMismatchReason,
  DesktopWindowMetadata,
} from '../../../shared/types/desktop';

/** One eligible window as reported by the native helper. `handle` is the OS
 * window number/HWND; frames are in the requested display's image pixels. */
export const nativeWindowSchema = z
  .object({
    handle: z.string().min(1),
    pid: z.number().int().positive(),
    appName: z.string().min(1),
    bundleId: z.string().min(1).optional(),
    title: z.string().optional(),
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export const nativeWindowStateSchema = z
  .object({
    frontmost: z
      .object({
        appName: z.string().min(1),
        bundleId: z.string().min(1).optional(),
        pid: z.number().int().positive(),
        focusedHandle: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    windows: z.array(nativeWindowSchema),
  })
  .strict();
export type NativeWindow = z.infer<typeof nativeWindowSchema>;
export type NativeWindowState = z.infer<typeof nativeWindowStateSchema>;
type Point = { x: number; y: number };

/** Handles (HWNDs in particular) can be recycled, so the owner pid is part of
 * the identity: a recycled handle in another process is a different window. */
export function windowKey(w: { pid: number; handle: string }): string {
  return `${w.pid}:${w.handle}`;
}

/** Session-scoped opaque window IDs: stable while a window exists, never reused,
 * and meaningless to any other session (each session owns its own instance). */
export class DesktopWindowIds {
  private readonly byKey = new Map<string, string>();
  private readonly byId = new Map<string, string>();
  private count = 0;
  constructor(private readonly mint: (n: number) => string = () => `win-${randomUUID()}`) {}
  idFor(w: { pid: number; handle: string }): string {
    const key = windowKey(w);
    let id = this.byKey.get(key);
    if (!id) {
      id = this.mint(++this.count);
      this.byKey.set(key, id);
      this.byId.set(id, key);
    }
    return id;
  }
  keyFor(windowId: string): string | undefined {
    return this.byId.get(windowId);
  }
}

const contains = (w: NativeWindow, p: Point) =>
  w.x <= p.x && p.x < w.x + w.width && w.y <= p.y && p.y < w.y + w.height;

/** Ordered contract checks; returns the first failing reason or undefined.
 * `windows` must be eligible windows in front-to-back order. */
export function targetReason(
  state: NativeWindowState,
  key: string | undefined,
  point?: Point,
): Exclude<DesktopTargetMismatchReason, 'not_focused'> | undefined {
  const target = key ? state.windows.find((w) => windowKey(w) === key) : undefined;
  if (!target) return 'window_unavailable';
  if (state.frontmost?.pid !== target.pid) return 'not_frontmost';
  if (point) {
    if (!contains(target, point)) return 'outside_window';
    const topmost = state.windows.find((w) => contains(w, point));
    if (!topmost || windowKey(topmost) !== key) return 'obscured';
  }
  return undefined;
}

/** The focused window's key, only when it is an eligible window. */
export function focusedKey(state: NativeWindowState): string | undefined {
  const f = state.frontmost;
  if (!f?.focusedHandle) return undefined;
  const key = windowKey({ pid: f.pid, handle: f.focusedHandle });
  return state.windows.some((w) => windowKey(w) === key) ? key : undefined;
}

/** Converts a native snapshot into ScreenshotResult `frontmost`/`windows` for one
 * display of the given image size. Frames are not clipped. */
export function describeWindows(
  state: NativeWindowState,
  ids: DesktopWindowIds,
  display: { width: number; height: number },
): { frontmost?: DesktopFrontmostApp; windows: DesktopWindowMetadata[] } {
  const focused = focusedKey(state);
  const windows = state.windows
    .filter(
      (w) => w.x < display.width && w.x + w.width > 0 && w.y < display.height && w.y + w.height > 0,
    )
    .map((w): DesktopWindowMetadata => ({
      windowId: ids.idFor(w),
      appName: w.appName,
      ...(w.bundleId ? { bundleId: w.bundleId } : {}),
      pid: w.pid,
      ...(w.title ? { title: w.title } : {}),
      x: w.x,
      y: w.y,
      width: w.width,
      height: w.height,
      focused: windowKey(w) === focused,
    }));
  const f = state.frontmost;
  if (!f) return { windows };
  const focusedWindow = focused ? state.windows.find((w) => windowKey(w) === focused) : undefined;
  return {
    frontmost: {
      appName: f.appName,
      ...(f.bundleId ? { bundleId: f.bundleId } : {}),
      pid: f.pid,
      ...(focusedWindow ? { windowId: ids.idFor(focusedWindow) } : {}),
    },
    windows,
  };
}
