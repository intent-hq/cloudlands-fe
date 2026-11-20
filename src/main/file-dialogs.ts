/**
 * File dialogs — the one place that decides between the native Electron file
 * chooser and the in-app picker.
 *
 * Every main-process open/save chooser goes through {@link showOpenDialog} /
 * {@link showSaveDialog} (`file-dialogs.guard.test.ts` fails on any other direct
 * `dialog.showOpenDialog` / `dialog.showSaveDialog` call). With
 * INTENT_IN_APP_PICKER=1 (set by the Intent OS launcher, whose session has no
 * working portal for native choosers) the request goes to the window's shown
 * renderer, which presents the in-app picker over the frontend host's
 * filesystem (listed here, not by the daemon, so the chosen path is always one
 * this process can open or write). Elsewhere the native dialog is unchanged.
 *
 * The return values mirror Electron's so callers keep their cancel handling.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type {
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
  WebContents,
} from 'electron';
import { z } from 'zod';

import { IPC_CHANNELS } from '../shared/ipc-registry';
import {
  extensionsFromAccept,
  extensionsFromFilters,
  mimeTypeForFileName,
  type InAppFileDialogRequest,
  type InAppPickedFile,
  type LocalDirectoryListing,
} from '../shared/in-app-file-dialog';
import { Logger } from '../shared/logger';
import { createSafeValidatedHandler } from './ipc-validation-middleware';
import { getShownRendererWebContents } from './window-backend';

const logger = new Logger('FileDialogs');

/**
 * Whether this session must use the in-app picker instead of native choosers.
 * @internal
 */
export function inAppFileDialogsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.INTENT_IN_APP_PICKER === '1';
}

type OwnerWindow = BrowserWindow | null | undefined;
type InAppRequestBody = Omit<InAppFileDialogRequest, 'id'>;

/** @internal */
export interface FileDialogDeps {
  inAppEnabled(): boolean;
  nativeOpen(win: OwnerWindow, options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
  nativeSave(win: OwnerWindow, options: SaveDialogOptions): Promise<SaveDialogReturnValue>;
  /** Present the in-app picker; resolves to the chosen paths or `null` on cancel. */
  requestInApp(win: OwnerWindow, request: InAppRequestBody): Promise<string[] | null>;
}

/**
 * Map Electron open options onto an in-app request.
 * @internal
 */
export function openRequestFromOptions(options: OpenDialogOptions): InAppRequestBody {
  const properties = options.properties ?? ['openFile'];
  const directory = properties.includes('openDirectory') && !properties.includes('openFile');
  return {
    kind: 'open',
    title: options.title,
    defaultPath: options.defaultPath,
    directory,
    multiple: !directory && properties.includes('multiSelections'),
    extensions: directory ? undefined : extensionsFromFilters(options.filters),
    buttonLabel: options.buttonLabel,
  };
}

/**
 * Map Electron save options onto an in-app request.
 * @internal
 */
export function saveRequestFromOptions(options: SaveDialogOptions): InAppRequestBody {
  return {
    kind: 'save',
    title: options.title,
    defaultPath: options.defaultPath,
    extensions: extensionsFromFilters(options.filters),
    buttonLabel: options.buttonLabel,
  };
}

/** @internal */
export function createFileDialogs(deps: FileDialogDeps) {
  return {
    async showOpenDialog(
      win: OwnerWindow,
      options: OpenDialogOptions,
    ): Promise<OpenDialogReturnValue> {
      if (!deps.inAppEnabled()) return deps.nativeOpen(win, options);
      const request = openRequestFromOptions(options);
      const paths = await deps.requestInApp(win, request);
      if (!paths || paths.length === 0) return { canceled: true, filePaths: [] };
      return { canceled: false, filePaths: request.multiple ? paths : paths.slice(0, 1) };
    },
    async showSaveDialog(
      win: OwnerWindow,
      options: SaveDialogOptions,
    ): Promise<SaveDialogReturnValue> {
      if (!deps.inAppEnabled()) return deps.nativeSave(win, options);
      const paths = await deps.requestInApp(win, saveRequestFromOptions(options));
      const filePath = paths?.[0];
      return filePath ? { canceled: false, filePath } : { canceled: true, filePath: '' };
    },
  };
}

// ---------------------------------------------------------------------------
// In-app transport: one pending request per id, answered by the renderer the
// request was sent to.

interface PendingRequest {
  contents: WebContents;
  resolve(paths: string[] | null): void;
}

const pending = new Map<string, PendingRequest>();

function ownerFor(win: OwnerWindow): BrowserWindow | null {
  const candidate =
    win && !win.isDestroyed()
      ? win
      : (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null);
  return candidate && !candidate.isDestroyed() ? candidate : null;
}

function requestInAppDialog(win: OwnerWindow, body: InAppRequestBody): Promise<string[] | null> {
  const owner = ownerFor(win);
  if (!owner) {
    logger.warn('No window to show the in-app file dialog in', { kind: body.kind });
    return Promise.resolve(null);
  }
  if (owner.isMinimized()) owner.restore();
  owner.focus();
  return requestInAppDialogIn(getShownRendererWebContents(owner), body);
}

function requestInAppDialogIn(
  contents: WebContents,
  body: InAppRequestBody,
): Promise<string[] | null> {
  if (contents.isDestroyed()) return Promise.resolve(null);
  const id = randomUUID();
  return new Promise((resolve) => {
    const settle = (paths: string[] | null) => {
      if (!pending.delete(id)) return;
      contents.off('destroyed', onGone);
      contents.off('render-process-gone', onGone);
      contents.off('did-navigate', onGone);
      resolve(paths);
    };
    const onGone = () => settle(null);
    pending.set(id, { contents, resolve: settle });
    contents.once('destroyed', onGone);
    contents.once('render-process-gone', onGone);
    // A reload drops the renderer's queue; treat it as a cancel.
    contents.once('did-navigate', onGone);
    const request: InAppFileDialogRequest = { id, ...body };
    contents.send(IPC_CHANNELS.IN_APP_FILE_DIALOG.REQUEST, request);
  });
}

function hasPendingRequestFor(sender: WebContents): boolean {
  for (const entry of pending.values()) if (entry.contents === sender) return true;
  return false;
}

const fileDialogs = createFileDialogs({
  inAppEnabled: () => inAppFileDialogsEnabled(),
  // Native callers keep their exact previous calls (window-modal when given a window).
  nativeOpen: (win, options) =>
    win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options),
  nativeSave: (win, options) =>
    win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options),
  requestInApp: requestInAppDialog,
});

/** Open chooser: native, or the in-app picker under INTENT_IN_APP_PICKER=1. */
export const showOpenDialog = fileDialogs.showOpenDialog;
/** Save chooser: native, or the in-app picker under INTENT_IN_APP_PICKER=1. */
export const showSaveDialog = fileDialogs.showSaveDialog;

// ---------------------------------------------------------------------------
// Frontend-host listing for the in-app picker. Same shape as the daemon's
// `host.listDirectory`, so the picker's view renders it unchanged.

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function userDir(name: 'desktop' | 'documents' | 'downloads', home: string): string {
  try {
    return app.getPath(name);
  } catch {
    return path.join(home, name[0].toUpperCase() + name.slice(1));
  }
}

/** @internal */
export async function listLocalDirectory(
  requested: string | undefined,
  home: string = os.homedir(),
): Promise<LocalDirectoryListing> {
  const expanded =
    requested === '~' ? home : requested?.startsWith('~/') ? home + requested.slice(1) : requested;
  let target = path.resolve(expanded?.trim() || home);
  // A default path naming a file opens its folder, as native dialogs do.
  if (requested && !(await isDirectory(target)) && (await exists(target))) {
    target = path.dirname(target);
  }
  const dirents = await fs.readdir(target, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map(async (dirent) => {
      const entryPath = path.join(target, dirent.name);
      const directory =
        dirent.isDirectory() || (dirent.isSymbolicLink() && (await isDirectory(entryPath)));
      return {
        name: dirent.name,
        path: entryPath,
        isDirectory: directory,
        isGitRepo: directory && (await exists(path.join(entryPath, '.git'))),
      };
    }),
  );
  entries.sort((a, b) =>
    a.isDirectory !== b.isDirectory
      ? a.isDirectory
        ? -1
        : 1
      : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  const favorites = [{ id: 'home', path: home }];
  for (const id of ['desktop', 'documents', 'downloads'] as const) {
    const dir = userDir(id, home);
    if (dir !== home && (await isDirectory(dir))) favorites.push({ id, path: dir });
  }
  const parent = path.dirname(target);
  return { path: target, parent: parent === target ? null : parent, home, entries, favorites };
}

async function readPickedFile(filePath: string): Promise<InAppPickedFile> {
  const name = path.basename(filePath);
  const data = await fs.readFile(filePath);
  return {
    name,
    path: filePath,
    type: mimeTypeForFileName(name),
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}

const PathSchema = z.object({ path: z.string().optional() });
const RequiredPathSchema = z.object({ path: z.string().min(1) });
const RespondSchema = z.object({
  id: z.string().min(1),
  paths: z.array(z.string().min(1)).nullable(),
});
const PickFilesSchema = z.object({
  accept: z.string().optional(),
  multiple: z.boolean().optional(),
  title: z.string().optional(),
});

function requirePendingRequest(sender: WebContents): void {
  if (!hasPendingRequestFor(sender)) {
    throw new Error('No in-app file dialog is open for this window');
  }
}

/** Register the in-app picker's IPC handlers. Idempotent per process start. */
export function registerFileDialogHandlers(): void {
  const channels = IPC_CHANNELS.IN_APP_FILE_DIALOG;

  ipcMain.handle(
    channels.RESPOND,
    createSafeValidatedHandler(
      RespondSchema,
      async (event, { id, paths }) => {
        const entry = pending.get(id);
        if (!entry || entry.contents !== event.sender) return { ok: false };
        entry.resolve(paths && paths.length > 0 ? paths : null);
        return { ok: true };
      },
      channels.RESPOND,
    ),
  );

  // Listing and folder creation are only served while this renderer has a
  // dialog open, so the renderer cannot browse the host outside a user action.
  ipcMain.handle(
    channels.LIST_DIRECTORY,
    createSafeValidatedHandler(
      PathSchema,
      async (event, { path: requested }) => {
        requirePendingRequest(event.sender);
        return listLocalDirectory(requested);
      },
      channels.LIST_DIRECTORY,
    ),
  );

  ipcMain.handle(
    channels.CREATE_DIRECTORY,
    createSafeValidatedHandler(
      RequiredPathSchema,
      async (event, { path: target }) => {
        requirePendingRequest(event.sender);
        await fs.mkdir(path.resolve(target));
        return { ok: true };
      },
      channels.CREATE_DIRECTORY,
    ),
  );

  // Renderer file inputs: run the in-app open dialog, then hand back only the
  // files the user picked.
  ipcMain.handle(
    channels.PICK_FILES,
    createSafeValidatedHandler(
      PickFilesSchema,
      async (event, { accept, multiple, title }): Promise<InAppPickedFile[] | null> => {
        if (!inAppFileDialogsEnabled()) return null;
        // Ask the renderer whose input was clicked: it is the one on screen.
        const paths = await requestInAppDialogIn(event.sender, {
          kind: 'open',
          title,
          multiple: multiple === true,
          extensions: extensionsFromAccept(accept),
        });
        if (!paths || paths.length === 0) return null;
        return Promise.all((multiple ? paths : paths.slice(0, 1)).map(readPickedFile));
      },
      channels.PICK_FILES,
    ),
  );
}
