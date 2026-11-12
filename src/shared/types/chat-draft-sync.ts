import { z } from 'zod';

/** Desktop-local messages on the existing authenticated backend bridge, never daemon RPCs. */
export const DRAFT_SYNC_METHOD = 'intent.drafts.sync';
export const DRAFT_SYNC_CHANGED = 'intent.drafts.changed';
const attachment = z.object({
  id: z.string(),
  type: z.string(),
  label: z.string(),
  description: z.string().optional(),
  content: z.string().optional(),
  path: z.string().optional(),
  imageData: z.string().optional(),
  imageMimeType: z.string().optional(),
  attachmentId: z.string().optional(),
  attachmentMimeType: z.string().optional(),
  attachmentSize: z.number().optional(),
  sourcePath: z.string().optional(),
  placementStatus: z.literal('failed').optional(),
  screen: z.unknown().optional(),
});
export const SharedDraftSnapshotSchema = z.object({
  text: z.string(),
  attachments: z.array(attachment),
});
export type SharedDraftSnapshot = z.infer<typeof SharedDraftSnapshotSchema>;
const address = {
  provenance: z.string().min(1),
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
};
const version = { lifetime: z.string(), revision: z.number().int().nonnegative() };
export const DraftSyncRequestSchema = z.discriminatedUnion('kind', [
  z.object({ ...address, kind: z.literal('read') }),
  z.object({
    ...address,
    ...version,
    kind: z.literal('edit'),
    origin: z.string().min(1),
    sequence: z.number().int().positive(),
    snapshot: SharedDraftSnapshotSchema,
  }),
  z.object({ ...address, ...version, kind: z.literal('flush') }),
  z.object({ ...address, ...version, kind: z.literal('clear'), origin: z.string().min(1) }),
]);
export const SharedDraftSchema = z.object({
  ...address,
  ...version,
  origin: z.string(),
  sequence: z.number().int().nonnegative(),
  snapshot: SharedDraftSnapshotSchema,
});
export type DraftSyncRequest = z.infer<typeof DraftSyncRequestSchema>;
export type SharedDraft = z.infer<typeof SharedDraftSchema>;
export const DraftSyncResultSchema = z.object({ accepted: z.boolean(), draft: SharedDraftSchema });
export type DraftSyncResult = z.infer<typeof DraftSyncResultSchema>;
