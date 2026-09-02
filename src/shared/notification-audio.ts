import { z } from 'zod';

// Bound both disk reads and the IPC payload. Notification clips should be short.
export const MAX_NOTIFICATION_SOUND_BYTES = 5 * 1024 * 1024;

export const NotificationSoundPathSchema = z
  .string()
  .max(4096)
  .refine(
    (path) =>
      /^(?:\/(?!\/)|[a-zA-Z]:[\\/])/.test(path) && !path.includes('\0') && /\.mp3$/i.test(path),
  );
export const PickNotificationSoundSchema = z.object({}).strict();
export const ReadNotificationSoundSchema = z.object({ path: NotificationSoundPathSchema }).strict();

export const PickNotificationSoundResponseSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), data: NotificationSoundPathSchema.nullable() }),
  z.object({ success: z.literal(false) }),
]);
export const ReadNotificationSoundResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    data: z
      .string()
      .max(Math.ceil(MAX_NOTIFICATION_SOUND_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  }),
  z.object({ success: z.literal(false) }),
]);
