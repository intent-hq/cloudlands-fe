/**
 * Downloads under INTENT_IN_APP_PICKER=1.
 *
 * A download with no save path makes Electron show the native Save dialog,
 * which opens nothing on Intent OS. While the flag is on, every session's
 * downloads start into a private staging file at once (Electron needs the
 * path synchronously); the in-app Save picker asks where it goes, and the file
 * moves there once both the download and the choice are done. Cancelling the
 * picker cancels the download and removes the staging file.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { BrowserWindow, DownloadItem, Session, WebContents } from 'electron';

import { Logger } from '../shared/logger';

const logger = new Logger('InAppDownloads');

type DownloadState = 'completed' | 'cancelled' | 'interrupted';

/**
 * The parts of a DownloadItem this module uses.
 * @internal
 */
export type StagedDownload = Pick<
  DownloadItem,
  'getFilename' | 'setSavePath' | 'getState' | 'cancel' | 'once'
>;

/** @internal */
export interface InAppDownloadDeps {
  /** Ask for the destination; resolves the chosen path or `null` on cancel. */
  askSavePath(defaultFileName: string): Promise<string | null>;
  stagingDir: string;
}

function safeFileName(name: string): string {
  const base = path.basename(name || 'download').replace(/[\\/:\0]/g, '_');
  return base && base !== '.' && base !== '..' ? base : 'download';
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await fs.copyFile(from, to);
    await fs.rm(from, { force: true });
  }
}

/**
 * Stage `item` and finish it at the user's chosen path. Resolves the final
 * path, or `null` when the user cancelled or the download did not complete.
 * @internal
 */
export async function routeDownloadThroughInAppPicker(
  item: StagedDownload,
  deps: InAppDownloadDeps,
): Promise<string | null> {
  const fileName = safeFileName(item.getFilename());
  const staged = path.join(deps.stagingDir, `${randomUUID()}-${fileName}`);
  item.setSavePath(staged);
  const done = new Promise<DownloadState>((resolve) => {
    item.once('done', (_event, state) => resolve(state));
  });
  await fs.mkdir(deps.stagingDir, { recursive: true }).catch(() => undefined);

  const target = await deps.askSavePath(fileName).catch(() => null);
  if (!target) {
    if (item.getState() === 'progressing') item.cancel();
    await done;
    await fs.rm(staged, { force: true });
    return null;
  }
  const state = await done;
  if (state !== 'completed') {
    await fs.rm(staged, { force: true });
    return null;
  }
  await moveFile(staged, target);
  return target;
}

const routedSessions = new WeakSet<Session>();

/**
 * Route `session`'s downloads through the in-app Save picker (once per
 * session). `ownerFor` names the window whose picker asks.
 */
export function routeSessionDownloads(
  session: Session,
  ownerFor: (contents: WebContents | undefined) => BrowserWindow | null,
  showSaveDialog: (
    win: BrowserWindow | null,
    options: { defaultPath: string },
  ) => Promise<{ canceled: boolean; filePath?: string }>,
): void {
  if (routedSessions.has(session)) return;
  routedSessions.add(session);
  const stagingDir = path.join(os.tmpdir(), 'intent-downloads');
  session.on('will-download', (_event, item, contents) => {
    const owner = ownerFor(contents);
    void routeDownloadThroughInAppPicker(item, {
      stagingDir,
      askSavePath: async (defaultFileName) => {
        const result = await showSaveDialog(owner, { defaultPath: defaultFileName });
        return result.canceled || !result.filePath ? null : result.filePath;
      },
    }).catch((error: unknown) => {
      logger.warn('Download through the in-app picker failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
}
