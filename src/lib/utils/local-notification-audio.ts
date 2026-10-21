import { hasCapability } from './platform-capabilities';
import { NOTIFICATION_CHANNELS } from '$shared/ipc/channels';
import {
  PickNotificationSoundResponseSchema,
  ReadNotificationSoundResponseSchema,
} from '$shared/notification-audio';

/** Bypass daemon/mock IPC routing: these operations belong to this desktop. */
export async function pickLocalNotificationSound(): Promise<string | null> {
  if (!hasCapability('nativeDialogs')) return null;
  const response = PickNotificationSoundResponseSchema.parse(
    await window.electronAPI.invoke(NOTIFICATION_CHANNELS.PICK_SOUND, {}),
  );
  if (!response.success) throw new Error('Notification sound selection failed');
  return response.data;
}

export async function readLocalNotificationSound(path: string): Promise<ArrayBuffer | null> {
  if (!hasCapability('nativeDialogs')) return null;
  const response = ReadNotificationSoundResponseSchema.parse(
    await window.electronAPI.invoke(NOTIFICATION_CHANNELS.READ_SOUND, { path }),
  );
  if (!response.success) return null;
  const bytes = Uint8Array.from(atob(response.data), (character) => character.charCodeAt(0));
  return bytes.buffer;
}
