import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
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

interface NativeCursorModule {
  create(handle: Buffer): unknown;
  update(token: unknown, state: CursorState & { kind: DockCursorKind }): void;
  dispose(token: unknown): void;
  inspect(token: unknown): unknown;
}

interface DockCursorController {
  update(state: CursorState): void;
  cursorChanged(type: string): void;
  dispose(): void;
  inspect(): unknown;
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
    let state: CursorState = { regions: [], excludedRegions: [], revision: 0, enabled: false };
    let lastUpdate = '';
    const publish = (): void => {
      if (disposed) return;
      const next = { ...state, kind };
      const identity = JSON.stringify(next);
      if (identity === lastUpdate) return;
      try {
        native.update(token, next);
        lastUpdate = identity;
      } catch (error) {
        lastUpdate = '';
        logger.warn('Failed to update native dock cursor', { error });
      }
    };
    const controller: DockCursorController = {
      update(next) {
        state = next;
        publish();
      },
      cursorChanged(type) {
        kind = cursorKind(type);
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
    };
    controllers.set(window, controller);
    return controller;
  } catch (error) {
    logger.warn('Failed to attach native dock cursor', { error });
  }
}
