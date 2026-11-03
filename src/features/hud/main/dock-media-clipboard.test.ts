/**
 * Main side of dock media copy/paste: a copy writes the media and Intent's metadata
 * into a folder main owns, then sets the system clipboard to that file (PNG data as
 * well for a PNG); a paste only recognises a file in that folder with valid
 * metadata; a failed write leaves nothing behind; old entries are pruned.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  BrowserWindow: {},
  clipboard: {},
  ClipboardItem: class {},
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  Menu: { buildFromTemplate: vi.fn() },
}));
vi.mock('../../../shared/logger', () => ({
  Logger: class {
    warn = vi.fn();
    info = vi.fn();
    debug = vi.fn();
    error = vi.fn();
  },
}));

import { createDockMediaClipboard } from './dock-media-clipboard';

let root: string;
let pasteboard: string | null;
let calls: string[][];
const osascript = vi.fn(async (args: string[]) => {
  calls.push(args);
  const script = args.filter((_, index) => args[index - 1] === '-e').join('\n');
  if (script.includes('POSIX path of (the clipboard')) {
    if (!pasteboard) throw new Error('no file on the clipboard');
    return `${pasteboard}\n`;
  }
  pasteboard = args.at(-1) ?? null;
  return '';
});
const make = (platform: NodeJS.Platform = 'darwin') =>
  createDockMediaClipboard({
    platform,
    root: () => root,
    osascript,
    writeImage: vi.fn(async () => undefined),
  });
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const mark = {
  tool: 'box' as const,
  geometry: { kind: 'rect' as const, x: 1, y: 2, w: 30, h: 40 },
  bounds: { x: 1, y: 2, w: 30, h: 40 },
  element: null,
};
const screenshot = {
  kind: 'image' as const,
  name: 'screenshot-20261103.png',
  mimeType: 'image/png' as const,
  bytes: png,
  intent: {
    pixels: {
      mimeType: 'image/png' as const,
      width: 800,
      height: 600,
      displayScale: 2,
      capturedAt: '2026-11-03T12:00:00.000Z',
    },
    raw: new Uint8Array([9, 9, 9]),
    marks: [mark],
  },
};
const clip = {
  kind: 'clip' as const,
  name: 'clip-1234abcd.mp4',
  mimeType: 'video/mp4',
  bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
  durationMs: 42_000,
  hasMicAudio: true,
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'dock-clipboard-'));
  pasteboard = null;
  calls = [];
  osascript.mockClear();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('dock media clipboard', () => {
  it('copies a screenshot as its PNG and file, and pastes it back editable', async () => {
    const service = make();
    expect(await service.write(screenshot)).toEqual({ ok: true });
    // One AppleScript write: PNG data and the file reference, the path as an argument.
    const write = calls[0]!;
    expect(write.join(' ')).toContain('«class PNGf»');
    expect(write.join(' ')).toContain('«class furl»');
    expect(write.at(-1)).toMatch(new RegExp(`^${root}/[0-9a-f-]+/screenshot-20261103\\.png$`));
    expect(await fs.readFile(write.at(-1)!)).toEqual(Buffer.from(png));
    expect(await service.read()).toEqual({
      kind: 'image',
      name: 'screenshot-20261103.png',
      size: png.byteLength,
      pixels: { ...screenshot.intent.pixels, base64: Buffer.from([9, 9, 9]).toString('base64') },
      marks: [mark],
    });
  });

  it('copies a recording as its video file and pastes it with its duration', async () => {
    const service = make();
    expect(await service.write(clip)).toEqual({ ok: true });
    expect(calls[0]!.join(' ')).not.toContain('PNGf');
    const content = await service.read();
    expect(content).toMatchObject({
      kind: 'clip',
      name: 'clip-1234abcd.mp4',
      mimeType: 'video/mp4',
      size: clip.bytes.byteLength,
      durationMs: 42_000,
      hasMicAudio: true,
    });
    // The file lives in main's folder, not in any draft: it outlives the source.
    expect((content as { sourcePath: string }).sourcePath.startsWith(root)).toBe(true);
  });

  it('copies a pasted JPEG as a file, without Intent metadata (an ordinary paste)', async () => {
    const service = make();
    const jpeg = {
      kind: 'image' as const,
      name: 'photo',
      mimeType: 'image/jpeg' as const,
      bytes: png,
    };
    expect(await service.write(jpeg)).toEqual({ ok: true });
    expect(calls[0]!.join(' ')).not.toContain('PNGf');
    expect(calls[0]!.at(-1)).toMatch(/photo\.jpg$/);
    expect(await service.read()).toBeNull();
  });

  it('recognises only its own entries: another app’s file, a moved file, bad metadata', async () => {
    const service = make();
    expect(await service.read()).toBeNull();
    pasteboard = '/Users/someone/Desktop/notes.png';
    expect(await service.read()).toBeNull();
    await service.write(clip);
    const own = pasteboard!;
    await fs.writeFile(path.join(path.dirname(own), 'intent-media.json'), '{"version":2}');
    expect(await service.read()).toBeNull();
    await service.write(clip);
    pasteboard = path.join(path.dirname(pasteboard!), 'elsewhere.mp4');
    expect(await service.read()).toBeNull();
  });

  it('a failed clipboard write reports failure and leaves no entry', async () => {
    const service = make();
    osascript.mockRejectedValueOnce(new Error('AppleScript error'));
    expect(await service.write(clip)).toEqual({ ok: false, error: 'failed' });
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('keeps only the newest entries', async () => {
    const service = make();
    for (let index = 0; index < 9; index += 1) {
      await service.write(clip);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(await fs.readdir(root)).toHaveLength(6);
    expect(await service.read()).toMatchObject({ kind: 'clip' });
  });

  it('elsewhere writes the image itself, refuses a recording, and never recognises a paste', async () => {
    const service = make('linux');
    expect(await service.write(screenshot)).toEqual({ ok: true });
    // Only a path could reach the clipboard: refused, so Cut keeps the recording.
    expect(await service.write(clip)).toEqual({ ok: false, error: 'unsupported' });
    expect(osascript).not.toHaveBeenCalled();
    expect(await service.read()).toBeNull();
  });
});
