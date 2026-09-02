import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';
import { m } from '../../../shared/paraglide/messages.js';
import {
  MAX_NOTIFICATION_SOUND_BYTES,
  NotificationSoundPathSchema,
} from '../../../shared/notification-audio';

/** Only app-window main frames may access local audio; never embedded web content. */
function appWindow(event: IpcMainInvokeEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window?.webContents === event.sender && event.senderFrame === event.sender.mainFrame
    ? window
    : null;
}

/** Skip ID3 metadata, then require an MPEG Layer III frame (not just a renamed file). */
function audioOffset(bytes: Buffer): number | null {
  let offset = 0;
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3') {
    if (bytes.length < 10 || bytes.subarray(6, 10).some((byte) => byte > 127)) return null;
    offset = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
    if (bytes[3] === 4 && bytes[5] & 0x10) offset += 10;
  }
  if (offset + 4 > bytes.length) return null;
  const [a, b, c] = bytes.subarray(offset, offset + 3);
  return a === 0xff &&
    (b & 0xe0) === 0xe0 &&
    (b & 0x18) !== 0x08 &&
    (b & 0x06) === 0x02 &&
    (c & 0xf0) !== 0 &&
    (c & 0xf0) !== 0xf0 &&
    (c & 0x0c) !== 0x0c
    ? offset
    : null;
}

/** Desktop filesystem only. No daemon, shell, workspace URLs, or unbounded readFile. */
async function readMp3(path: string): Promise<string | null> {
  if (!NotificationSoundPathSchema.safeParse(path).success || !isAbsolute(path)) return null;
  // Resolve symlinks before opening so a .mp3 alias cannot expose an arbitrary file.
  const resolved = await realpath(path);
  if (!NotificationSoundPathSchema.safeParse(resolved).success || !isAbsolute(resolved))
    return null;
  const file = await open(
    resolved,
    constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 4 || stat.size > MAX_NOTIFICATION_SOUND_BYTES) return null;
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) return null;
      offset += bytesRead;
    }
    const start = audioOffset(bytes);
    return start === null ? null : bytes.subarray(start).toString('base64');
  } finally {
    await file.close();
  }
}

export async function pickNotificationSound(event: IpcMainInvokeEvent) {
  const window = appWindow(event);
  if (!window) return { success: false };
  try {
    const result = await dialog.showOpenDialog(window, {
      title: m.settings_notifications_chooseSound_ariaLabel(),
      properties: ['openFile'],
      filters: [{ name: m.settings_notifications_mp3Files_label(), extensions: ['mp3'] }],
    });
    if (result.canceled) return { success: true, data: null };
    const path = result.filePaths[0];
    if (result.filePaths.length !== 1 || !path || !(await readMp3(path))) return { success: false };
    return { success: true, data: path };
  } catch {
    return { success: false };
  }
}

export async function readNotificationSound(event: IpcMainInvokeEvent, { path }: { path: string }) {
  if (!appWindow(event)) return { success: false };
  try {
    const data = await readMp3(path);
    return data ? { success: true, data } : { success: false };
  } catch {
    return { success: false };
  }
}
