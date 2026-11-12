/** Offline chat preparation only; no capture, recording, speech or annotation commands. */
import { z } from 'zod';
import { IPC_CHANNELS } from './ipc-registry';
import { DockSavedMediaSchema } from './dock-media-edit';
import {
  DockMediaExportRequestSchema,
  DockMediaTranscribeRequestSchema,
} from './dock-media-output';
export const CHAT_MEDIA_CHANNELS = IPC_CHANNELS.CHAT_MEDIA;
const id = z.string().min(1).max(512);
export const ChatMediaBeginSchema = z
  .object({
    workspaceId: id,
    agentId: id,
    draftId: z.guid(),
    principalId: id,
    media: z.array(DockSavedMediaSchema).min(1).max(20),
  })
  .strict();
export type ChatMediaBegin = z.infer<typeof ChatMediaBeginSchema>;
export const ChatMediaScopeSchema = z.object({ sessionId: z.guid() }).strict();
export const ChatMediaControlSchema = ChatMediaScopeSchema.extend({
  control: z.discriminatedUnion('action', [
    z.object({ action: z.literal('readiness') }).strict(),
    z.object({ action: z.literal('export'), request: DockMediaExportRequestSchema }).strict(),
    z
      .object({ action: z.literal('transcribe'), request: DockMediaTranscribeRequestSchema })
      .strict(),
    z.object({ action: z.literal('release'), jobId: z.guid() }).strict(),
    z.object({ action: z.literal('adopt'), jobId: z.guid() }).strict(),
  ]),
}).strict();
export type ChatMediaControl = z.infer<typeof ChatMediaControlSchema>;
