/** Renderer describes edits and raster layers; main alone chooses every native path. */
import { z } from 'zod';
import { DockSavedMediaSchema, type DockMediaTranscript } from './dock-media-edit';
export const DockMediaExportRequestSchema = z.object({
  jobId: z.string().uuid(),
  media: DockSavedMediaSchema,
  layers: z.array(z.object({
    atMs: z.number().finite().nonnegative(),
    endMs: z.number().finite().nonnegative(),
    png: z.string().min(1).max(48 * 1024 * 1024),
  }).strict()).max(1000),
}).strict();
export type DockMediaExportRequest = z.infer<typeof DockMediaExportRequestSchema>;
export interface DockMediaNativeFile { sourcePath: string; mimeType: string; size: number }
export interface DockMediaNativeOutput {
  jobId: string;
  video: DockMediaNativeFile;
  frames: Array<DockMediaNativeFile & { markId: string }>;
}
export const DockMediaTranscribeRequestSchema = z.object({
  jobId: z.string().uuid(), media: DockSavedMediaSchema,
  locale: z.string().min(1).max(80).optional(),
}).strict();
export type DockMediaTranscribeRequest = z.infer<typeof DockMediaTranscribeRequestSchema>;
export type DockMediaTranscribeOutput = DockMediaTranscript;
