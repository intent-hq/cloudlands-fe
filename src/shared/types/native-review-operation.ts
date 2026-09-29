/** Original-socket native review contract. Public correlation never grants authority. */
import { z } from 'zod';
import {
  RepositoryContextRevisionSchema,
  RepositoryRootIdentitySchema,
  RepositoryTargetSchema,
  type RepositoryRootIdentity,
} from './repository-context';
import {
  NativeReviewExecutionSchema,
  NativeReviewPreparationSchema,
  NativeReviewStageSchema,
} from './native-review';

const id = z.string().min(1).max(4096);
const counter = RepositoryContextRevisionSchema.shape.sequence;
export const NativeReviewRootSchema = z.discriminatedUnion('kind', [
  RepositoryRootIdentitySchema.options[0].strict(),
  RepositoryRootIdentitySchema.options[1].strict(),
]);
export const NativeReviewInputSchema = z
  .object({
    workspaceId: id,
    action: NativeReviewStageSchema,
    files: z.array(z.string()).nullish(),
    options: z
      .object({
        stageUnstaged: z.boolean().optional(),
        pushAfterCommit: z.boolean().optional(),
        createPRAfterPush: z.boolean().optional(),
      })
      .strict()
      .optional(),
    review: z
      .object({
        root: NativeReviewRootSchema,
        choice: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('saved') }).strict(),
          z
            .object({ kind: z.literal('explicitTarget'), target: RepositoryTargetSchema.strict() })
            .strict(),
        ]),
        targetBranch: z.string().nullish(),
        pushRemote: z.string().nullish(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      value.workspaceId === value.review.root.workspaceId &&
      (value.action === 'commit' ||
        (value.files == null &&
          !value.options?.stageUnstaged &&
          !value.options?.pushAfterCommit &&
          !value.options?.createPRAfterPush)),
  );
export type NativeReviewInput = z.infer<typeof NativeReviewInputSchema>;

export const NativeReviewTextCommandSchema = z
  .object({
    commitMessage: z.string().nullish(),
    prTitle: z.string().nullish(),
    prBody: z.string().nullish(),
  })
  .strict();
export type NativeReviewTextCommand = z.infer<typeof NativeReviewTextCommandSchema>;

const display = {
  valid: z.boolean(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  suggestedCommitMessage: z.string().optional(),
  suggestedPRTitle: z.string().optional(),
  suggestedPRBody: z.string().optional(),
  filesCount: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  files: z.array(
    z
      .object({
        path: z.string(),
        staged: z.boolean(),
        additions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
      })
      .strict(),
  ),
  reviewPreparation: NativeReviewPreparationSchema,
};
export const NativeReviewCaptureSchema = z
  .object({
    ...display,
    reviewOperation: z
      .object({
        operationId: id,
        root: NativeReviewRootSchema,
        retirementSequence: counter,
        expiresAfterMs: z.literal(300_000),
      })
      .strict(),
  })
  .strict();
export const NativeReviewPreparedViewSchema = z
  .object({ ...display, root: NativeReviewRootSchema, expiresAfterMs: z.literal(300_000) })
  .strict();
export type NativeReviewPreparedView = z.infer<typeof NativeReviewPreparedViewSchema>;
const state = {
  operationId: id,
  root: NativeReviewRootSchema,
  state: z.enum(['prepared', 'pending', 'settled']),
  reviewExecution: NativeReviewExecutionSchema.optional(),
};
const consistent = (value: { state: string; reviewExecution?: unknown }) =>
  (value.state === 'settled') === (value.reviewExecution !== undefined);
export const NativeReviewReconcileResultSchema = z.object(state).strict().refine(consistent);
export const NativeReviewExecuteResultSchema = z
  .object({
    ...state,
    state: z.enum(['pending', 'settled']),
    success: z.boolean(),
    steps: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          status: z.enum(['pending', 'running', 'completed', 'failed']),
          message: z.string().optional(),
          error: z.string().optional(),
        })
        .strict(),
    ),
    result: z
      .object({
        commitHash: z.string().optional(),
        pushedSha: z.string().optional(),
        prNumber: z.number().int().nonnegative().optional(),
        prUrl: z.string().optional(),
      })
      .strict()
      .optional(),
    error: z.string().optional(),
  })
  .strict()
  .refine(consistent);
export type NativeReviewExecuteResult = z.infer<typeof NativeReviewExecuteResultSchema>;
export type NativeReviewReconcileResult = z.infer<typeof NativeReviewReconcileResultSchema>;
export const NativeReviewNoticeSchema = z
  .object({
    operationIds: z.array(id).max(64),
    sequence: counter,
    allRetired: z.boolean(),
    terminal: z.boolean(),
  })
  .strict();
export const NativeReviewObservationSchema = z
  .object({
    current: z.boolean(),
    uncertain: z.boolean(),
    execute: NativeReviewExecuteResultSchema.nullable(),
    reconciliation: NativeReviewReconcileResultSchema.nullable(),
  })
  .strict();
export type NativeReviewObservation = z.infer<typeof NativeReviewObservationSchema>;
export type NativeReviewRetirement = 'admission' | 'closed';
export interface NativeReviewOwner {
  readonly attemptId: string;
  readonly root: RepositoryRootIdentity;
  readonly admission: string | null;
  readonly hostContext: string | null;
}
export const NativeReviewOwnerSchema = z
  .object({
    attemptId: id,
    root: NativeReviewRootSchema,
    admission: z.string().nullable(),
    hostContext: z.string().nullable(),
  })
  .strict();
export interface NativeReviewSession {
  readonly preview: NativeReviewPreparedView;
  onRetired(handler: (kind: NativeReviewRetirement) => void): () => void;
  confirm(command: NativeReviewTextCommand): Promise<NativeReviewObservation>;
  reconcile(): Promise<NativeReviewObservation>;
  release(): Promise<void>;
}
