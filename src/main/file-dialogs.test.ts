import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: (name: string) => path.join(os.tmpdir(), `no-such-${name}`) },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {},
  ipcMain: { handle: vi.fn() },
}));
vi.mock('./window-backend', () => ({ getShownRendererWebContents: vi.fn() }));

import {
  createFileDialogs,
  inAppFileDialogsEnabled,
  listLocalDirectory,
  openRequestFromOptions,
  saveRequestFromOptions,
  type FileDialogDeps,
} from './file-dialogs';

function harness(inApp: boolean, answer: string[] | null = null) {
  const deps = {
    inAppEnabled: () => inApp,
    nativeOpen: vi.fn(async () => ({ canceled: false, filePaths: ['/native/open'] })),
    nativeSave: vi.fn(async () => ({ canceled: false, filePath: '/native/save' })),
    requestInApp: vi.fn(async () => answer),
  } satisfies FileDialogDeps;
  return { deps, dialogs: createFileDialogs(deps) };
}

describe('inAppFileDialogsEnabled', () => {
  it('is on for INTENT_IN_APP_PICKER=1 or Intent OS (INTENT_OS=1)', () => {
    expect(inAppFileDialogsEnabled({ INTENT_IN_APP_PICKER: '1' })).toBe(true);
    expect(inAppFileDialogsEnabled({ INTENT_OS: '1' })).toBe(true);
    expect(inAppFileDialogsEnabled({ INTENT_IN_APP_PICKER: '0' })).toBe(false);
    expect(inAppFileDialogsEnabled({})).toBe(false);
  });
});

describe('createFileDialogs — flag off', () => {
  it('uses the native open and save dialogs unchanged', async () => {
    const { deps, dialogs } = harness(false);
    const options = { properties: ['openFile' as const] };
    await expect(dialogs.showOpenDialog(null, options)).resolves.toEqual({
      canceled: false,
      filePaths: ['/native/open'],
    });
    await expect(dialogs.showSaveDialog(undefined, { defaultPath: 'a.zip' })).resolves.toEqual({
      canceled: false,
      filePath: '/native/save',
    });
    expect(deps.nativeOpen).toHaveBeenCalledWith(null, options);
    expect(deps.nativeSave).toHaveBeenCalledWith(undefined, { defaultPath: 'a.zip' });
    expect(deps.requestInApp).not.toHaveBeenCalled();
  });
});

describe('createFileDialogs — flag on', () => {
  it('opens the in-app picker and never the native dialog', async () => {
    const { deps, dialogs } = harness(true, ['/home/me/a.zip']);
    const result = await dialogs.showOpenDialog(null, {
      properties: ['openFile'],
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    expect(result).toEqual({ canceled: false, filePaths: ['/home/me/a.zip'] });
    expect(deps.nativeOpen).not.toHaveBeenCalled();
    expect(deps.requestInApp).toHaveBeenCalledWith(null, {
      kind: 'open',
      title: undefined,
      defaultPath: undefined,
      directory: false,
      multiple: false,
      extensions: ['zip'],
      buttonLabel: undefined,
    });
  });

  it('reports a cancelled open like Electron does', async () => {
    const { dialogs } = harness(true, null);
    await expect(dialogs.showOpenDialog(null, {})).resolves.toEqual({
      canceled: true,
      filePaths: [],
    });
  });

  it('returns every path for multiSelections and only the first otherwise', async () => {
    const paths = ['/a.png', '/b.png'];
    const multi = harness(true, paths);
    await expect(
      multi.dialogs.showOpenDialog(null, { properties: ['openFile', 'multiSelections'] }),
    ).resolves.toEqual({ canceled: false, filePaths: paths });
    const single = harness(true, paths);
    await expect(
      single.dialogs.showOpenDialog(null, { properties: ['openFile'] }),
    ).resolves.toEqual({ canceled: false, filePaths: ['/a.png'] });
  });

  it('saves to the chosen path, keeping the default name and filters', async () => {
    const { deps, dialogs } = harness(true, ['/home/me/Downloads/report.zip']);
    await expect(
      dialogs.showSaveDialog(undefined, {
        defaultPath: 'report.zip',
        filters: [{ name: 'Zip', extensions: ['zip'] }],
      }),
    ).resolves.toEqual({ canceled: false, filePath: '/home/me/Downloads/report.zip' });
    expect(deps.nativeSave).not.toHaveBeenCalled();
    expect(deps.requestInApp).toHaveBeenCalledWith(undefined, {
      kind: 'save',
      title: undefined,
      defaultPath: 'report.zip',
      extensions: ['zip'],
      buttonLabel: undefined,
    });
  });

  it('reports a cancelled save like Electron does', async () => {
    const { dialogs } = harness(true, null);
    await expect(dialogs.showSaveDialog(undefined, {})).resolves.toEqual({
      canceled: true,
      filePath: '',
    });
  });
});

describe('request mapping', () => {
  it('maps directory pickers and drops file filters for them', () => {
    expect(
      openRequestFromOptions({
        properties: ['openDirectory', 'createDirectory'],
        filters: [{ name: 'Zip', extensions: ['zip'] }],
      }),
    ).toMatchObject({ kind: 'open', directory: true, multiple: false, extensions: undefined });
  });

  it('treats a * filter as every file', () => {
    expect(
      saveRequestFromOptions({ filters: [{ name: 'All', extensions: ['*'] }] }).extensions,
    ).toBeUndefined();
  });
});

describe('listLocalDirectory', () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it('lists folders first, marks git repos and opens a file path as its folder', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'file-dialogs-'));
    await mkdir(path.join(root, 'repo', '.git'), { recursive: true });
    await mkdir(path.join(root, 'b-folder'));
    await writeFile(path.join(root, 'a.txt'), 'hi');

    const listing = await listLocalDirectory(path.join(root, 'a.txt'), root);
    expect(listing.path).toBe(root);
    expect(listing.parent).toBe(path.dirname(root));
    expect(listing.home).toBe(root);
    expect(
      listing.entries.map((entry) => [entry.name, entry.isDirectory, entry.isGitRepo]),
    ).toEqual([
      ['b-folder', true, false],
      ['repo', true, true],
      ['a.txt', false, false],
    ]);
    expect(listing.favorites).toEqual([{ id: 'home', path: root }]);
  });

  it('expands ~ against home', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'file-dialogs-'));
    await expect(listLocalDirectory('~', root)).resolves.toMatchObject({ path: root });
  });
});
