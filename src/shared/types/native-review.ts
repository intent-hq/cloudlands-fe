/**
 * Inactive mirror of intent-core's native_review response extensions.
 * These schemas validate observations, not admission, commands or retry safety.
 * No metadata, completed stage or publication relationship is inferred here.
 */
import { z } from 'zod';
import {
  ExecutionScopeSchema,
  RepositoryConnectionScopeSchema,
  RepositoryContextRevisionSchema,
  RepositoryRootIdentitySchema,
  RepositoryTargetSchema,
  ReviewTargetSchema,
} from './repository-context';

export const NativeReviewBranchTargetSchema = z.object({
  repository: RepositoryTargetSchema,
  providerProjectId: z.string().nullable(),
  connection: RepositoryConnectionScopeSchema.nullable(),
  branch: z.string(),
});
export type NativeReviewBranchTarget = z.infer<typeof NativeReviewBranchTargetSchema>;

export const NativeReviewTransportSchema = z.object({
  remoteName: z.string(),
  fetchUrls: z.array(z.string()),
  pushUrls: z.array(z.string()),
});
export type NativeReviewTransport = z.infer<typeof NativeReviewTransportSchema>;

export const NativeReviewPreparationSchema = z.object({
  operationId: z.string(),
  scope: ExecutionScopeSchema,
  contextRevision: RepositoryContextRevisionSchema,
  root: RepositoryRootIdentitySchema,
  worktreeId: z.string(),
  source: NativeReviewBranchTargetSchema,
  target: NativeReviewBranchTargetSchema,
  localHeadSha: z.string().nullable(),
  transport: NativeReviewTransportSchema.nullable(),
});
export type NativeReviewPreparation = z.infer<typeof NativeReviewPreparationSchema>;

export const NativeReviewGitReceiptSchema = z.discriminatedUnion('stage', [
  z.object({ stage: z.literal('commit'), commitHash: z.string() }),
  z.object({ stage: z.literal('push'), pushedSha: z.string() }),
]);
export type NativeReviewGitReceipt = z.infer<typeof NativeReviewGitReceiptSchema>;

export const NativeReviewStageSchema = z.enum(['commit', 'push', 'create-pr']);
export type NativeReviewStage = z.infer<typeof NativeReviewStageSchema>;

export const NativeReviewStateSchema = z.enum(['open', 'locked', 'closed', 'merged']);
export type NativeReviewState = z.infer<typeof NativeReviewStateSchema>;

export const NativeReviewBranchIdentitySchema = z.object({
  provider: RepositoryTargetSchema.shape.provider,
  instanceBaseUrl: z.string(),
  projectId: z.string(),
  projectPath: z.string().nullable(),
  branch: z.string(),
});
export type NativeReviewBranchIdentity = z.infer<typeof NativeReviewBranchIdentitySchema>;

export const NativeReviewDetailsSchema = z.object({
  resource: ReviewTargetSchema,
  url: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  state: NativeReviewStateSchema.nullable(),
  draft: z.boolean().nullable(),
  sourceBranch: z.string().nullable(),
  targetBranch: z.string().nullable(),
  source: NativeReviewBranchIdentitySchema.nullable(),
  target: NativeReviewBranchIdentitySchema.nullable(),
  author: z.string().nullable(),
  mergeable: z.boolean().nullable(),
  mergeableState: z.string().nullable(),
  headSha: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type NativeReviewDetails = z.infer<typeof NativeReviewDetailsSchema>;

export const NativeReviewOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not-attempted') }),
  z.object({ status: z.literal('created'), review: NativeReviewDetailsSchema }),
  z.object({ status: z.literal('reused'), review: NativeReviewDetailsSchema }),
  z.object({
    status: z.literal('failed'),
    stage: NativeReviewStageSchema,
    code: z.string().nullable(),
    message: z.string(),
  }),
  z.object({
    status: z.literal('uncertain'),
    stage: NativeReviewStageSchema,
    message: z.string(),
  }),
]);
export type NativeReviewOutcome = z.infer<typeof NativeReviewOutcomeSchema>;

export const NativeReviewPublicationSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('included'),
    localHeadSha: z.string(),
    remoteSourceSha: z.string(),
  }),
  z.object({
    state: z.literal('local-ahead'),
    localHeadSha: z.string(),
    remoteSourceSha: z.string(),
  }),
  z.object({
    state: z.literal('diverged'),
    localHeadSha: z.string(),
    remoteSourceSha: z.string(),
  }),
  z.object({ state: z.literal('remote-branch-missing'), localHeadSha: z.string().nullable() }),
  z.object({
    state: z.literal('unknown'),
    localHeadSha: z.string().nullable(),
    remoteSourceSha: z.string().nullable(),
  }),
]);
export type NativeReviewPublication = z.infer<typeof NativeReviewPublicationSchema>;

export const NativeReviewExecutionSchema = z.object({
  requestId: z.string(),
  preparation: NativeReviewPreparationSchema,
  gitReceipts: z.array(NativeReviewGitReceiptSchema),
  outcome: NativeReviewOutcomeSchema,
  publication: NativeReviewPublicationSchema,
});
export type NativeReviewExecution = z.infer<typeof NativeReviewExecutionSchema>;

/** Parse only the additive fields; existing prepare/execute payloads retain their owner. */
export const NativeReviewPrepareExtensionSchema = z
  .object({ reviewPreparation: NativeReviewPreparationSchema.optional() })
  .passthrough();
export type NativeReviewPrepareExtension = z.infer<typeof NativeReviewPrepareExtensionSchema>;

export const NativeReviewExecuteExtensionSchema = z
  .object({ reviewExecution: NativeReviewExecutionSchema.optional() })
  .passthrough();
export type NativeReviewExecuteExtension = z.infer<typeof NativeReviewExecuteExtensionSchema>;
