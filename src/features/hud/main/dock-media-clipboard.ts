/**
 * Main side of dock media copy/cut/paste (see `$shared/dock-media-clipboard`).
 *
 * A copy writes the media into a folder this module owns
 * (`<userData>/dock-clipboard/<id>/`), with Intent's metadata beside it, then puts
 * the file on the system clipboard: on macOS through AppleScript, which sets the
 * file reference (and, for an image, its PNG data) in one write, so Finder, Slack,
 * Mail or a browser paste the real file. A paste reads the clipboard's file
 * reference back; only a file inside that folder, with valid metadata, is Intent
 * media. The newest few entries are kept, so a copy outlives its source draft.
 */
import { app, BrowserWindow, clipboard, ClipboardItem, ipcMain, Menu } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { m } from '../../../shared/paraglide/messages.js';
import { Logger } from '../../../shared/logger';
import { DOCK_MARK_TOOLS } from '../../../shared/dock-evidence';
import {
  DOCK_MEDIA_CHANNELS,
  type DockMediaClipboardContent,
  type DockMediaClipboardMark,
  type DockMediaClipboardResult,
  type DockMediaClipboardWrite,
} from '../../../shared/dock-media-clipboard';

const logger = new Logger('DockMediaClipboard');

/** Entries kept on disk: the clipboard holds one, the rest cover a quick re-copy. */
const KEEP_ENTRIES = 6;
const META = 'intent-media.json';
const MAX_CLIP_BYTES = 128 * 1024 * 1024;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

export interface DockMediaClipboardDeps {
  platform: NodeJS.Platform;
  root: () => string;
  /** Runs `osascript` with arguments; resolves its stdout, rejects on a non-zero exit. */
  osascript: (args: string[]) => Promise<string>;
  /** Other platforms: the image itself (a recording copy is refused there). */
  writeImage: (bytes: Buffer, mimeType: string) => Promise<void>;
}

const defaults: DockMediaClipboardDeps = {
  platform: process.platform,
  root: () => path.join(app.getPath('userData'), 'dock-clipboard'),
  osascript: (args) =>
    new Promise((resolve, reject) =>
      execFile('osascript', args, { timeout: 10_000 }, (error, stdout) =>
        error ? reject(error) : resolve(String(stdout)),
      ),
    ),
  writeImage: (bytes, mimeType) =>
    clipboard.write([
      new ClipboardItem({ [mimeType]: new Blob([new Uint8Array(bytes)], { type: mimeType }) }),
    ]),
};

// AppleScript: the path arrives as an argument, never inside the script text.
const SET_FILE = [
  '-e',
  'on run argv',
  '-e',
  'set the clipboard to {«class furl»:(POSIX file (item 1 of argv))}',
  '-e',
  'end run',
];
/** The clipboard's file reference as a POSIX path (fails when there is none). */
const GET_FILE = ['-e', 'POSIX path of (the clipboard as «class furl»)'];
const SET_IMAGE = [
  '-e',
  'on run argv',
  '-e',
  'set f to POSIX file (item 1 of argv)',
  '-e',
  'set the clipboard to {«class PNGf»:(read f as «class PNGf»), «class furl»:f}',
  '-e',
  'end run',
];

const safeName = (name: string, fallback: string) => {
  const base = path
    .basename(name)
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 96);
  return base && base !== '.' && base !== '..' ? base : fallback;
};

const markSchema = z
  .object({
    tool: z.enum(DOCK_MARK_TOOLS as unknown as [string, ...string[]]),
    geometry: z.object({ kind: z.string() }).passthrough(),
    bounds: z.object({ x: z.number(), y: z.number() }).passthrough(),
    element: z.unknown().nullable(),
  })
  .passthrough();
const metaSchema = z.discriminatedUnion('kind', [
  z.object({
    version: z.literal(1),
    kind: z.literal('image'),
    file: z.string(),
    raw: z.string(),
    pixels: z.object({
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      displayScale: z.number().positive(),
      capturedAt: z.string(),
      hash: z.string().optional(),
    }),
    marks: z.array(markSchema).max(99),
  }),
  z.object({
    version: z.literal(1),
    kind: z.literal('clip'),
    file: z.string(),
    mimeType: z.string().min(1).max(100),
    durationMs: z.number().nonnegative(),
    hasMicAudio: z.boolean(),
  }),
]);

/** @internal Dependency-injected factory used by the clipboard lifecycle contract tests. */
export function createDockMediaClipboard(overrides: Partial<DockMediaClipboardDeps> = {}) {
  const deps: DockMediaClipboardDeps = { ...defaults, ...overrides };

  async function prune(): Promise<void> {
    const root = deps.root();
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const dirs = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const full = path.join(root, entry.name);
          const stat = await fs.stat(full).catch(() => null);
          return { full, time: stat?.mtimeMs ?? 0 };
        }),
    );
    dirs.sort((a, b) => b.time - a.time);
    for (const dir of dirs.slice(KEEP_ENTRIES))
      await fs.rm(dir.full, { recursive: true, force: true }).catch(() => undefined);
  }

  async function write(request: DockMediaClipboardWrite): Promise<DockMediaClipboardResult> {
    // Off macOS a video file cannot be put on the clipboard (only its path as text),
    // so a recording copy is refused rather than reported done: Cut keeps the tile.
    if (request.kind === 'clip' && deps.platform !== 'darwin')
      return { ok: false, error: 'unsupported' };
    const dir = path.join(deps.root(), randomUUID());
    try {
      await fs.mkdir(dir, { recursive: true });
      let file: string;
      if (request.kind === 'image') {
        const extension =
          request.mimeType.split('/')[1] === 'jpeg' ? 'jpg' : request.mimeType.split('/')[1];
        file = path.join(
          dir,
          `${safeName(request.name, 'screenshot').replace(/\.\w+$/, '')}.${extension}`,
        );
        await fs.writeFile(file, request.bytes);
        if (request.intent) {
          const raw = path.join(dir, 'raw');
          await fs.writeFile(raw, request.intent.raw);
          await fs.writeFile(
            path.join(dir, META),
            JSON.stringify({
              version: 1,
              kind: 'image',
              file: path.basename(file),
              raw: 'raw',
              pixels: request.intent.pixels,
              marks: request.intent.marks,
            }),
          );
        }
        // PNG data as well as the file when it is a PNG (image editors paste data).
        if (deps.platform === 'darwin')
          await deps.osascript([
            ...(request.mimeType === 'image/png' ? SET_IMAGE : SET_FILE),
            file,
          ]);
        else await deps.writeImage(Buffer.from(request.bytes), request.mimeType);
      } else {
        file = path.join(dir, safeName(request.name, 'recording.mp4'));
        await fs.writeFile(file, request.bytes);
        await fs.writeFile(
          path.join(dir, META),
          JSON.stringify({
            version: 1,
            kind: 'clip',
            file: path.basename(file),
            mimeType: request.mimeType,
            durationMs: request.durationMs,
            hasMicAudio: request.hasMicAudio,
          }),
        );
        await deps.osascript([...SET_FILE, file]);
      }
      await prune();
      return { ok: true };
    } catch (error) {
      logger.warn('Failed to copy dock media to the clipboard', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Nothing is half-written: a failed copy leaves no entry behind.
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      return { ok: false, error: 'failed' };
    }
  }

  async function read(): Promise<DockMediaClipboardContent | null> {
    // macOS only: elsewhere the clipboard carries no file reference to recognise.
    if (deps.platform !== 'darwin') return null;
    let file: string;
    try {
      const posix = (await deps.osascript(GET_FILE)).trim();
      if (!posix.startsWith('/')) return null;
      file = path.resolve(posix);
    } catch {
      return null;
    }
    const root = path.resolve(deps.root());
    const dir = path.dirname(file);
    // Only an entry this module wrote: <root>/<id>/<file>.
    if (path.dirname(dir) !== root) return null;
    let meta: z.infer<typeof metaSchema>;
    try {
      meta = metaSchema.parse(JSON.parse(await fs.readFile(path.join(dir, META), 'utf8')));
    } catch {
      return null;
    }
    if (path.join(dir, meta.file) !== file) return null;
    try {
      // The digest of the file on the clipboard right now: a paste uses the entry only
      // if its own file has exactly these bytes (name and size are not identity).
      const exported = await fs.readFile(file);
      if (exported.byteLength <= 0) return null;
      const sha256 = createHash('sha256').update(exported).digest('hex');
      if (meta.kind === 'clip') {
        return {
          kind: 'clip',
          name: meta.file,
          mimeType: meta.mimeType,
          sourcePath: file,
          size: exported.byteLength,
          sha256,
          durationMs: meta.durationMs,
          hasMicAudio: meta.hasMicAudio,
        };
      }
      const raw = await fs.readFile(path.join(dir, path.basename(meta.raw)));
      return {
        kind: 'image',
        name: meta.file,
        size: exported.byteLength,
        sha256,
        pixels: { ...meta.pixels, base64: raw.toString('base64') },
        marks: meta.marks as unknown as DockMediaClipboardMark[],
      };
    } catch {
      return null;
    }
  }

  return { write, read };
}

const bytes = (max: number) =>
  z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= max);
const WriteSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    name: z.string().min(1).max(200),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    bytes: bytes(MAX_IMAGE_BYTES),
    intent: z
      .object({
        pixels: z.object({
          mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          displayScale: z.number().positive(),
          capturedAt: z.string().min(1).max(64),
          hash: z.string().max(128).optional(),
        }),
        raw: bytes(MAX_IMAGE_BYTES),
        marks: z.array(markSchema).max(99),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal('clip'),
    name: z.string().min(1).max(200),
    mimeType: z.string().min(1).max(100),
    bytes: bytes(MAX_CLIP_BYTES),
    durationMs: z
      .number()
      .nonnegative()
      .max(24 * 3600 * 1000),
    hasMicAudio: z.boolean(),
  }),
]);

/** Dock window only: the clipboard write, read and the tile's Copy/Cut menu. */
export function registerDockMediaClipboardIPC(
  getDockWindow: () => BrowserWindow | null,
  service = createDockMediaClipboard(),
): () => void {
  const fromDock = (event: Electron.IpcMainInvokeEvent) => {
    const dock = getDockWindow();
    return (
      !!dock &&
      !dock.isDestroyed() &&
      event.sender === dock.webContents &&
      event.senderFrame === event.sender.mainFrame
    );
  };
  ipcMain.handle(DOCK_MEDIA_CHANNELS.CLIPBOARD_WRITE, async (event, request: unknown) => {
    if (!fromDock(event)) return { ok: false, error: 'unsupported' };
    const parsed = WriteSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: 'invalid' };
    return service.write(parsed.data as DockMediaClipboardWrite);
  });
  ipcMain.handle(DOCK_MEDIA_CHANNELS.CLIPBOARD_READ, async (event) =>
    fromDock(event) ? service.read() : null,
  );
  ipcMain.handle(DOCK_MEDIA_CHANNELS.MENU, (event, request: { canCut?: unknown }) => {
    const window = getDockWindow();
    if (!fromDock(event) || !window) return { action: null };
    return new Promise<{ action: 'copy' | 'cut' | null }>((resolve) => {
      // macOS can run an item's click after the close callback: the click decides,
      // and closing without a choice resolves null on the next turn.
      Menu.buildFromTemplate([
        { label: m.dock_mediaClipboard_copy_label(), click: () => resolve({ action: 'copy' }) },
        {
          label: m.dock_mediaClipboard_cut_label(),
          enabled: request?.canCut === true,
          click: () => resolve({ action: 'cut' }),
        },
      ]).popup({ window, callback: () => setTimeout(() => resolve({ action: null }), 50) });
    });
  });
  return () => {
    for (const channel of Object.values(DOCK_MEDIA_CHANNELS)) ipcMain.removeHandler(channel);
  };
}
