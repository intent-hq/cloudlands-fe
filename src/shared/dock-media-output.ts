/** Renderer describes edits and raster layers; main alone chooses every native path. */
import { z } from 'zod';
import { DockSavedMediaSchema, DOCK_MEDIA_OUTPUT_VERSION, type DockMediaTranscript } from './dock-media-edit';
export const DockMediaExportRequestSchema = z.object({
  outputVersion: z.literal(DOCK_MEDIA_OUTPUT_VERSION),
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

/** Real decoded PCM peaks, indexed on the original source-media clock. */
export const DockMediaWaveformSchema = z.object({
  sourceId: z.string().min(1), sourceRevision: z.number().int().nonnegative(),
  durationMs: z.number().finite().positive().max(120001), intervalMs: z.literal(50),
  peaks: z.array(z.number().finite().min(0).max(1)).max(2401),
}).strict().refine((value) => value.peaks.length === Math.ceil(value.durationMs / value.intervalMs), 'Incomplete waveform');
export type DockMediaWaveform = z.infer<typeof DockMediaWaveformSchema>;
export const DockMediaAnalyzeRequestSchema = z.object({ jobId: z.string().uuid(), media: DockSavedMediaSchema }).strict();
export type DockMediaAnalyzeRequest = z.infer<typeof DockMediaAnalyzeRequestSchema>;
