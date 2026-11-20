import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));

import {
  routeDownloadThroughInAppPicker,
  routeSessionDownloads,
  type StagedDownload,
} from './in-app-downloads';

class FakeDownload extends EventEmitter {
  savePath = '';
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted' = 'progressing';
  cancel = vi.fn(() => this.finish('cancelled'));
  constructor(private readonly name: string) {
    super();
  }
  getFilename() {
    return this.name;
  }
  setSavePath(p: string) {
    this.savePath = p;
  }
  getState() {
    return this.state;
  }
  /** Simulate Electron finishing the transfer (writing the staged file when completed). */
  async finish(state: 'completed' | 'cancelled' | 'interrupted', body = 'data') {
    if (state === 'completed') await writeFile(this.savePath, body);
    this.state = state;
    this.emit('done', {}, state);
  }
}

const asItem = (d: FakeDownload) => d as unknown as StagedDownload;

let dir: string;
let staging: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'in-app-downloads-'));
  staging = path.join(dir, 'staging');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('routeDownloadThroughInAppPicker', () => {
  it('stages at once, then moves the finished file to the chosen path', async () => {
    const item = new FakeDownload('report.pdf');
    let choose!: (p: string | null) => void;
    const askSavePath = vi.fn(() => new Promise<string | null>((r) => (choose = r)));
    const routed = routeDownloadThroughInAppPicker(asItem(item), {
      askSavePath,
      stagingDir: staging,
    });

    expect(item.savePath.startsWith(staging)).toBe(true);
    expect(item.savePath.endsWith('-report.pdf')).toBe(true);
    await vi.waitFor(() => expect(askSavePath).toHaveBeenCalledWith('report.pdf'));
    await item.finish('completed', 'pdf bytes');
    choose(path.join(dir, 'saved.pdf'));

    await expect(routed).resolves.toBe(path.join(dir, 'saved.pdf'));
    expect(await readFile(path.join(dir, 'saved.pdf'), 'utf8')).toBe('pdf bytes');
    expect(await readdir(staging)).toEqual([]);
  });

  it('waits for a download that finishes after the user chose', async () => {
    const item = new FakeDownload('a.zip');
    const routed = routeDownloadThroughInAppPicker(asItem(item), {
      askSavePath: async () => path.join(dir, 'a.zip'),
      stagingDir: staging,
    });
    await new Promise((r) => setTimeout(r, 10));
    await item.finish('completed', 'zip');
    await expect(routed).resolves.toBe(path.join(dir, 'a.zip'));
  });

  it('cancels the download and removes the staging file when the user cancels', async () => {
    const item = new FakeDownload('a.zip');
    const routed = routeDownloadThroughInAppPicker(asItem(item), {
      askSavePath: async () => null,
      stagingDir: staging,
    });
    await expect(routed).resolves.toBeNull();
    expect(item.cancel).toHaveBeenCalledOnce();
    expect(await readdir(staging)).toEqual([]);
  });

  it('writes nothing when the download is interrupted', async () => {
    const item = new FakeDownload('a.zip');
    const routed = routeDownloadThroughInAppPicker(asItem(item), {
      askSavePath: async () => path.join(dir, 'a.zip'),
      stagingDir: staging,
    });
    await item.finish('interrupted');
    await expect(routed).resolves.toBeNull();
    await expect(readFile(path.join(dir, 'a.zip'))).rejects.toThrow();
  });

  it('never stages outside the staging folder, whatever the site names the file', async () => {
    const item = new FakeDownload('../../etc/passwd');
    const routed = routeDownloadThroughInAppPicker(asItem(item), {
      askSavePath: async () => null,
      stagingDir: staging,
    });
    expect(path.dirname(item.savePath)).toBe(staging);
    expect(path.basename(item.savePath).endsWith('-passwd')).toBe(true);
    await routed;
  });
});

describe('routeSessionDownloads', () => {
  it('asks for the page that started the download and cancels when it cannot', async () => {
    const session = new EventEmitter();
    const popup = { id: 42 };
    const askSavePath = vi.fn(async () => null);
    routeSessionDownloads(session as never, askSavePath, staging);
    routeSessionDownloads(session as never, askSavePath, staging);
    expect(session.listenerCount('will-download')).toBe(1);

    const item = new FakeDownload('popup.pdf');
    session.emit('will-download', {}, item, popup);
    await vi.waitFor(() => expect(item.cancel).toHaveBeenCalledOnce());
    expect(askSavePath).toHaveBeenCalledWith(popup, 'popup.pdf');
  });
});
