import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { app, type BrowserWindow, type NativeImage } from 'electron';
import type { DockPointerRect } from '../shared/dock-layout';
import { Logger } from '../shared/logger';

const logger = new Logger('DockCursor');
const requireNative = createRequire(import.meta.url);
type DockCursorKind =
  | 'grab'
  | 'grabbing'
  | 'ns-resize'
  | 'ew-resize'
  | 'nesw-resize'
  | 'nwse-resize'
  | 'pointer'
  | 'text'
  | 'custom'
  | 'none';

function cursorKind(type: string): DockCursorKind {
  switch (type) {
    case 'grab':
    case 'grabbing':
    case 'pointer':
      return type;
    case 'hand':
      return 'pointer';
    case 'text':
    case 'vertical-text':
      return 'text';
    case 'n-resize':
    case 's-resize':
    case 'ns-resize':
      return 'ns-resize';
    case 'e-resize':
    case 'w-resize':
    case 'ew-resize':
      return 'ew-resize';
    case 'ne-resize':
    case 'sw-resize':
    case 'nesw-resize':
      return 'nesw-resize';
    case 'nw-resize':
    case 'se-resize':
    case 'nwse-resize':
      return 'nwse-resize';
    default:
      return 'none';
  }
}

interface CursorState {
  regions: readonly DockPointerRect[];
  excludedRegions: readonly DockPointerRect[];
  revision: number;
  enabled: boolean;
}

/** Chromium's custom (CSS url()) cursor as Electron reports it: PNG pixels at `scale`. */
interface DockCustomCursor {
  image: NativeImage;
  scale: number;
  size: { width: number; height: number };
  hotspot: { x: number; y: number };
}

interface NativeCustomImage {
  id: string;
  png?: Buffer;
  scale: number;
  hotspotX: number;
  hotspotY: number;
}

const MAX_CUSTOM_PNG_BYTES = 262144;
const MAX_CUSTOM_PIXELS = 256;
const MAX_CUSTOM_POINTS = 64;

/** A bounded custom image, or null (the caller then shows no native cursor). */
function customCursorImage(
  custom: DockCustomCursor | undefined,
): (NativeCustomImage & { png: Buffer }) | null {
  try {
    return encodeCustomCursor(custom);
  } catch (error) {
    // A broken payload never escapes the cursor-changed handler: no native custom cursor.
    logger.warn('Ignoring an unreadable custom cursor image', { error });
    return null;
  }
}

function encodeCustomCursor(
  custom: DockCustomCursor | undefined,
): (NativeCustomImage & { png: Buffer }) | null {
  if (!custom || !custom.image || custom.image.isEmpty()) return null;
  const { scale, hotspot } = custom;
  if (!Number.isFinite(scale) || scale < 1 || scale > 4) return null;
  const { width, height } = custom.image.getSize();
  if (!(width >= 1 && height >= 1 && width <= MAX_CUSTOM_PIXELS && height <= MAX_CUSTOM_PIXELS))
    return null;
  if (width / scale > MAX_CUSTOM_POINTS || height / scale > MAX_CUSTOM_POINTS) return null;
  if (!Number.isFinite(hotspot?.x) || !Number.isFinite(hotspot?.y)) return null;
  if (hotspot.x < 0 || hotspot.y < 0 || hotspot.x >= width || hotspot.y >= height) return null;
  const png = custom.image.toPNG();
  if (png.length < 8 || png.length > MAX_CUSTOM_PNG_BYTES) return null;
  const id = createHash('sha256')
    .update(png)
    .update(`|${scale}|${hotspot.x}|${hotspot.y}`)
    .digest('hex')
    .slice(0, 32);
  return { id, png, scale, hotspotX: hotspot.x, hotspotY: hotspot.y };
}

interface NativeCursorModule {
  create(handle: Buffer): unknown;
  update(
    token: unknown,
    state: CursorState & { kind: DockCursorKind; image?: NativeCustomImage },
  ): void;
  dispose(token: unknown): void;
  inspect(token: unknown): unknown;
  /** Optional: an older helper build lacks it (the caller then falls back to blur). */
  releaseKey?(token: unknown): boolean;
  /** Present on builds that accept `custom` cursors; older builds never receive one. */
  supportsCustom?: boolean;
}

export interface DockCursorController {
  update(state: CursorState): void;
  /** `custom` carries Chromium's image; without native support it shows no native cursor. */
  cursorChanged(type: string, custom?: DockCustomCursor): void;
  dispose(): void;
  inspect(): unknown;
  /**
   * Hands the keyboard back while the dock stays on screen; true when the dock is no
   * longer key. False when unavailable or refused (the caller may blur instead).
   */
  releaseKey(): boolean;
}

const controllers = new WeakMap<BrowserWindow, DockCursorController>();

function isNativeCursorModule(value: unknown): value is NativeCursorModule {
  if (!value || typeof value !== 'object') return false;
  return ['create', 'update', 'dispose', 'inspect'].every(
    (key) => typeof Reflect.get(value, key) === 'function',
  );
}

function loadNativeCursor(): NativeCursorModule | undefined {
  const roots = app.isPackaged
    ? [process.resourcesPath]
    : [
        path.resolve(app.getAppPath(), '..', '..', 'resources'),
        path.join(app.getAppPath(), 'resources'),
      ];
  for (const root of roots) {
    const file = path.join(root, 'dock-helper', 'intent-dock-cursor.node');
    if (!existsSync(file)) continue;
    const module: unknown = requireNative(file);
    if (!isNativeCursorModule(module)) throw new Error('Invalid native dock cursor module');
    return module;
  }
  logger.warn('Native dock cursor module is unavailable');
}

/** Own dock grab/resize cursors without activating its window or the app. */
export function attachDockCursor(window: BrowserWindow): DockCursorController | undefined {
  if (process.platform !== 'darwin') return;
  const existing = controllers.get(window);
  if (existing) return existing;
  try {
    const native = loadNativeCursor();
    if (!native) return;
    const token = native.create(window.getNativeWindowHandle());
    let disposed = false;
    let kind: DockCursorKind = 'none';
    let image: (NativeCustomImage & { png: Buffer }) | null = null;
    let sentImageId = '';
    // An image native refused is not retried (it falls back to no native cursor).
    let rejectedImageId = '';
    let state: CursorState = { regions: [], excludedRegions: [], revision: 0, enabled: false };
    let lastUpdate = '';
    const publish = (): void => {
      if (disposed) return;
      const custom = kind === 'custom' && image ? image : null;
      // The image identity is part of the update identity: pen -> box stays `custom`.
      const identity = JSON.stringify({ ...state, kind, image: custom?.id ?? null });
      if (identity === lastUpdate) return;
      const next: CursorState & { kind: DockCursorKind; image?: NativeCustomImage } = {
        ...state,
        kind,
      };
      if (custom) {
        const { png, ...meta } = custom;
        // PNG bytes cross only when the native side has not built this image yet.
        next.image = custom.id === sentImageId ? meta : { ...meta, png };
      }
      try {
        native.update(token, next);
        lastUpdate = identity;
        if (custom) sentImageId = custom.id;
      } catch (error) {
        lastUpdate = '';
        sentImageId = '';
        if (custom) {
          rejectedImageId = custom.id;
          image = null;
          kind = 'none';
          logger.warn('Native dock cursor refused a custom image; using no native cursor', {
            error,
          });
          publish();
          return;
        }
        logger.warn('Failed to update native dock cursor', { error });
      }
    };
    const controller: DockCursorController = {
      update(next) {
        state = next;
        publish();
      },
      cursorChanged(type, custom) {
        if (type === 'custom' && native.supportsCustom === true) {
          const candidate = customCursorImage(custom);
          image = candidate && candidate.id !== rejectedImageId ? candidate : null;
          kind = image ? 'custom' : 'none';
        } else {
          image = null;
          kind = cursorKind(type);
        }
        publish();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        controllers.delete(window);
        try {
          native.dispose(token);
        } catch (error) {
          logger.warn('Failed to dispose native dock cursor', { error });
        }
      },
      inspect: () => native.inspect(token),
      releaseKey() {
        if (disposed || typeof native.releaseKey !== 'function') return false;
        try {
          return native.releaseKey(token) === true;
        } catch (error) {
          logger.warn('Failed to hand the keyboard back from the dock', { error });
          return false;
        }
      },
    };
    controllers.set(window, controller);
    return controller;
  } catch (error) {
    logger.warn('Failed to attach native dock cursor', { error });
  }
}
