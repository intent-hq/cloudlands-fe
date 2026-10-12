import { z } from 'zod';

// Proposed IPC only; no channel registration or transport activation in this draft.
const id = z.string().min(1).max(128);
export const WorkspaceLoadOriginRefSchema = z.object({ originId: id }).strict();
export const WorkspaceLoadPrepareSchema = WorkspaceLoadOriginRefSchema.extend({
  requestId: id,
  workspaceId: z.string().min(1).max(512),
}).strict();
export const WorkspaceLoadRouteRefSchema = WorkspaceLoadPrepareSchema.extend({
  routeId: id,
}).strict();
/** Full route release or cancellation of one consumed prepare tuple. */
export const WorkspaceLoadReleaseSchema = z.union([
  WorkspaceLoadRouteRefSchema,
  WorkspaceLoadPrepareSchema,
]);
export const WorkspaceLoadReadSchema = WorkspaceLoadRouteRefSchema.extend({
  operation: z.enum(['open', 'get']),
}).strict();

export type WorkspaceLoadOriginRef = z.infer<typeof WorkspaceLoadOriginRefSchema>;
export type WorkspaceLoadPrepare = z.infer<typeof WorkspaceLoadPrepareSchema>;
export type WorkspaceLoadRouteRef = z.infer<typeof WorkspaceLoadRouteRefSchema>;
export type WorkspaceLoadRead = z.infer<typeof WorkspaceLoadReadSchema>;
export type WorkspaceLoadRetired =
  ({ kind: 'origin' } & WorkspaceLoadOriginRef) | ({ kind: 'route' } & WorkspaceLoadRouteRef);

/** Structured original error; same fields as the existing backend IPC envelope. */
export const WorkspaceLoadErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    data: z.unknown().optional(),
    rpcCode: z.number().optional(),
  })
  .strict();
export type WorkspaceLoadError = z.infer<typeof WorkspaceLoadErrorSchema>;

/** Runtime validation at the actual bridge before exposing a domain result. */
export const WorkspaceLoadReadOutcomeSchema = z.discriminatedUnion('current', [
  z
    .object({
      ref: WorkspaceLoadRouteRefSchema,
      current: z.literal(false),
      reason: z.literal('retired'),
    })
    .strict(),
  z
    .object({
      ref: WorkspaceLoadRouteRefSchema,
      current: z.literal(true),
      settlement: z.discriminatedUnion('status', [
        z.object({ status: z.literal('fulfilled'), value: z.unknown() }).strict(),
        z.object({ status: z.literal('rejected'), error: WorkspaceLoadErrorSchema }).strict(),
      ]),
    })
    .strict(),
]);

/** Main checks currentness immediately before constructing this outcome. */
export type WorkspaceLoadReadOutcome<T = unknown> =
  | { ref: WorkspaceLoadRouteRef; current: false; reason: 'retired' }
  | {
      ref: WorkspaceLoadRouteRef;
      current: true;
      settlement:
        { status: 'fulfilled'; value: T } | { status: 'rejected'; error: WorkspaceLoadError };
    };

/** Inactive captured Git operations; none grants daemon access. */
const gitStatus = z
  .object({
    operation: z.literal('git-status'),
    forceRefresh: z.boolean().optional(),
  })
  .strict();
const trackedChanges = z.object({ operation: z.literal('tracked-changes') }).strict();
const commitsWithBoundary = z
  .object({
    operation: z.literal('commits-with-boundary'),
    includeOlder: z.boolean().optional(),
  })
  .strict();
const prRefresh = z
  .object({
    operation: z.literal('pr-refresh'),
    automatic: z.boolean().optional(),
  })
  .strict();
export const WorkspaceGitOperationSchema = z.discriminatedUnion('operation', [
  gitStatus,
  trackedChanges,
  commitsWithBoundary,
  prRefresh,
]);
export const WorkspaceGitReadSchema = z.discriminatedUnion('operation', [
  WorkspaceLoadRouteRefSchema.extend(gitStatus.shape).strict(),
  WorkspaceLoadRouteRefSchema.extend(trackedChanges.shape).strict(),
  WorkspaceLoadRouteRefSchema.extend(commitsWithBoundary.shape).strict(),
  WorkspaceLoadRouteRefSchema.extend(prRefresh.shape).strict(),
]);
export type WorkspaceGitOperation = z.infer<typeof WorkspaceGitOperationSchema>;
/** Local IPC containment only; PR refresh persists daemon state and is separately enabled. */
export type WorkspaceGitReadAccess = Readonly<{
  reads?: readonly Exclude<WorkspaceGitOperation['operation'], 'pr-refresh'>[];
  prRefresh?: boolean;
}>;

/** Opt-in only. Default PREPARE and full route references retain their strict shapes. */
export const WorkspaceGitPrepareSchema = WorkspaceLoadPrepareSchema.extend({
  operation: z.enum(['git-status', 'tracked-changes', 'commits-with-boundary', 'pr-refresh']),
}).strict();
export const WorkspaceGitProvenanceSchema = z.object({ physicalOwnerId: id }).strict();
export const WorkspaceGitPreparedSchema = z
  .object({
    ref: WorkspaceLoadRouteRefSchema,
    provenance: WorkspaceGitProvenanceSchema,
  })
  .strict();
export type WorkspaceGitProvenance = Readonly<z.infer<typeof WorkspaceGitProvenanceSchema>>;
export type WorkspaceGitPrepared = z.infer<typeof WorkspaceGitPreparedSchema>;
