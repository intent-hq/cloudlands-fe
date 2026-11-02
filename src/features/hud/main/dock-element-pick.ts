/**
 * Long-lived wrapper around `intent-dock-element-pick` (resources/dock/element-pick.swift).
 *
 * One request at a time per id; every request resolves within `timeoutMs`, and a
 * missing, crashed or silent helper degrades to an honest "unavailable" answer
 * (no window check, no element) instead of blocking a gesture.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { app, BrowserWindow } from 'electron';
import {
  dockWindowIdFromMediaSourceId,
  type DockAnnotationRect,
  type DockAxElement,
} from '../../../shared/dock-annotation';
import { isDockAnnotationWindow } from '../../../main/dock-annotation-identity';
import { getDockWindow } from '../../../main/dock-window';
import { Logger } from '../../../shared/logger';

const logger = new Logger('DockElementPick');

const DOCK_ELEMENT_PICK_HELPER = 'intent-dock-element-pick';

interface DockHitWindow {
  pid: number;
  windowId: number;
  app: string;
  bounds: DockAnnotationRect;
}

export interface DockElementHit {
  /** False when the helper could not answer; the window check is then skipped. */
  checked: boolean;
  /** Accessibility trust of the helper's responsible process. */
  access: 'granted' | 'permission' | 'unavailable';
  /** Front-most app window at the point (Intent's main windows included, never the dock or overlay); null over desktop, menus, menu bar or system UI. */
  window: DockHitWindow | null;
  element: DockAxElement | null;
}

export interface DockElementPickDependencies {
  platform: NodeJS.Platform;
  helperPath(): string | null;
  spawn(helper: string): ChildProcess;
  pid: number;
  /**
   * CGWindowIDs the helper looks through: the dock (transparent beyond its painted
   * surface, which gestures already refuse) and the markup overlay. Intent's main
   * app windows are ordinary targets.
   */
  seeThroughWindowIds(): number[];
  timeoutMs: number;
  /** After this many helper exits the picker stops respawning. */
  maxRestarts: number;
}

const UNAVAILABLE: DockElementHit = Object.freeze({
  checked: false,
  access: 'unavailable',
  window: null,
  element: null,
}) as DockElementHit;

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function parseRect(value: unknown): DockAnnotationRect | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (![x, y, width, height].every(finite) || (width as number) <= 0 || (height as number) <= 0)
    return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

function parseWindow(value: unknown): DockHitWindow | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const bounds = parseRect(row.bounds);
  if (!bounds || !Number.isSafeInteger(row.pid) || (row.pid as number) <= 0) return null;
  return {
    pid: row.pid as number,
    windowId: Number.isSafeInteger(row.windowId) ? (row.windowId as number) : 0,
    app: typeof row.app === 'string' ? row.app.slice(0, 512) : '',
    bounds,
  };
}

function parseElement(value: unknown): DockAxElement | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const rect = parseRect(row.rect);
  if (!rect) return null;
  const text = (input: unknown) => (typeof input === 'string' ? input.slice(0, 512) : '');
  const role = text(row.role);
  const name = text(row.name);
  if (!role && !name) return null;
  return { role, name, rect };
}

/** Parse one helper reply line; null when it is not a well-formed reply. */
export function parseDockHitReply(line: string): { id: number; hit: DockElementHit } | null {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!message || typeof message !== 'object' || !Number.isSafeInteger(message.id)) return null;
  const id = message.id as number;
  if (message.ok !== true) return { id, hit: UNAVAILABLE };
  const trusted = message.trusted === true;
  return {
    id,
    hit: {
      checked: true,
      access: trusted ? 'granted' : 'permission',
      window: parseWindow(message.window),
      element: trusted ? parseElement(message.element) : null,
    },
  };
}

export class DockElementPicker {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private restarts = 0;
  private trusted: boolean | null = null;
  private readonly pending = new Map<number, (hit: DockElementHit) => void>();

  constructor(private readonly deps: DockElementPickDependencies) {}

  /** Last known accessibility state, for honest UI; unknown until the helper speaks. */
  access(): DockElementHit['access'] {
    if (this.deps.platform !== 'darwin' || !this.deps.helperPath()) return 'unavailable';
    if (this.restarts >= this.deps.maxRestarts) return 'unavailable';
    return this.trusted === false ? 'permission' : 'granted';
  }

  /** Start the helper ahead of the first gesture so its answer is warm. */
  warm(): void {
    this.ensure();
  }

  hit(point: { x: number; y: number }, options: { element: boolean }): Promise<DockElementHit> {
    if (!finite(point.x) || !finite(point.y)) return Promise.resolve(UNAVAILABLE);
    const child = this.ensure();
    if (!child?.stdin || child.stdin.destroyed) return Promise.resolve(UNAVAILABLE);
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(UNAVAILABLE), this.deps.timeoutMs);
      const settle = (hit: DockElementHit) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        resolve(hit);
      };
      this.pending.set(id, settle);
      try {
        const command = {
          id,
          cmd: 'hit',
          x: point.x,
          y: point.y,
          element: options.element,
          ownPid: this.deps.pid,
          seeThroughWindowIds: this.deps.seeThroughWindowIds().slice(0, 256),
        };
        child.stdin!.write(`${JSON.stringify(command)}\n`);
      } catch {
        settle(UNAVAILABLE);
      }
    });
  }

  dispose(): void {
    this.flush();
    const child = this.child;
    this.child = null;
    // The next helper reports trust afresh (a grant made meanwhile counts).
    this.trusted = null;
    if (child && child.exitCode === null) child.kill();
  }

  private flush(): void {
    for (const settle of [...this.pending.values()]) settle(UNAVAILABLE);
  }

  private ensure(): ChildProcess | null {
    if (this.child) return this.child;
    if (this.deps.platform !== 'darwin' || this.restarts >= this.deps.maxRestarts) return null;
    const helper = this.deps.helperPath();
    if (!helper) return null;
    let child: ChildProcess;
    try {
      child = this.deps.spawn(helper);
    } catch {
      this.restarts += 1;
      return null;
    }
    this.child = child;
    const onExit = () => {
      if (this.child !== child) return;
      this.child = null;
      this.restarts += 1;
      this.flush();
    };
    child.once('exit', onExit);
    child.once('error', onExit);
    child.stdin?.on('error', () => {});
    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (this.child !== child) return;
        const reply = parseDockHitReply(line);
        if (reply) {
          if (reply.hit.checked) this.trusted = reply.hit.access === 'granted';
          this.pending.get(reply.id)?.(reply.hit);
          return;
        }
        try {
          const event = JSON.parse(line) as {
            event?: string;
            trusted?: unknown;
            responsible?: unknown;
          };
          if (event.event === 'ready') {
            this.trusted = event.trusted === true;
            // macOS checks Accessibility for the responsible app, which is not always
            // this one (a dev app started by another app inherits that app's grant).
            logger.info('Dock element picker ready', {
              helperTrusted: this.trusted,
              responsibleApp: typeof event.responsible === 'string' ? event.responsible : null,
            });
          }
        } catch {
          // Ignore non-JSON diagnostics.
        }
      });
    }
    return child;
  }
}

function defaultHelperPath(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'dock-helper', DOCK_ELEMENT_PICK_HELPER)]
    : [
        path.resolve(
          app.getAppPath(),
          '..',
          '..',
          'resources',
          'dock-helper',
          DOCK_ELEMENT_PICK_HELPER,
        ),
        path.join(app.getAppPath(), 'resources', 'dock-helper', DOCK_ELEMENT_PICK_HELPER),
      ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function createDockElementPicker(
  overrides: Partial<DockElementPickDependencies> = {},
): DockElementPicker {
  return new DockElementPicker({
    platform: process.platform,
    helperPath: defaultHelperPath,
    spawn: (helper) => spawn(helper, [], { stdio: ['pipe', 'pipe', 'ignore'] }),
    pid: process.pid,
    seeThroughWindowIds: () =>
      BrowserWindow.getAllWindows().flatMap((window) => {
        if (window.isDestroyed() || (!isDockAnnotationWindow(window) && window !== getDockWindow()))
          return [];
        const id = dockWindowIdFromMediaSourceId(window.getMediaSourceId());
        return id === null ? [] : [id];
      }),
    timeoutMs: 400,
    maxRestarts: 3,
    ...overrides,
  });
}
