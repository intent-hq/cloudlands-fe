/** Explicit resource reads: correlation and configured facts never grant authority. */
import { z } from 'zod';
import {
  ExecutionScopeSchema,
  RepositoryContextRevisionSchema,
  reviewTargetKey,
  sameExecutionScope,
} from './repository-context';
import { NativeReviewDetailsSchema } from './native-review';
import { isCanonicalGitLabInstance, parseGitLabResourceLink } from '../utils/gitlab-resource-link';

const id = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const counter = RepositoryContextRevisionSchema.shape.sequence;
const iid = z.number().int().positive().safe();
export const RepositoryResourceWorkspaceSchema = z.object({ workspaceId: id }).strict();
export const RepositoryResourceTargetSchema = z
  .object({
    repository: z
      .object({
        provider: z.literal('gitlab'),
        instanceBaseUrl: z.string().max(2048).refine(isCanonicalGitLabInstance),
        projectPath: z
          .string()
          .min(1)
          .max(1024)
          .refine((value) => {
            const parts = value.split('/');
            return (
              parts.length >= 2 &&
              parts[0] !== 'groups' &&
              parts.every(
                (part) => /^[A-Za-z0-9_.-]+$/.test(part) && !['.', '..', '-'].includes(part),
              )
            );
          }),
      })
      .strict(),
    kind: z.enum(['merge-request', 'issue']),
    number: iid,
  })
  .strict();
export type RepositoryResourceTarget = z.infer<typeof RepositoryResourceTargetSchema>;
export const RepositoryResourceCaptureSchema = z
  .object({
    readLifetimeId: id,
    scope: ExecutionScopeSchema.strict(),
    revision: RepositoryContextRevisionSchema.strict(),
    expiresAfterMs: z.literal(300_000),
    retirementSequence: counter,
    instances: z
      .array(
        z
          .object({
            provider: z.literal('gitlab'),
            instanceBaseUrl: z.string().max(2048).refine(isCanonicalGitLabInstance),
            availability: z.literal('connected'),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();
export type RepositoryResourceCapture = z.infer<typeof RepositoryResourceCaptureSchema>;
const RepositoryResourceFailureSchema = z.enum([
  'authentication',
  'project-denied',
  'resource-denied',
  'optional-restricted',
  'optional-unavailable',
  'rate-limited',
  'transient',
  'unavailable',
  'unknown',
]);
export type RepositoryResourceFailure = z.infer<typeof RepositoryResourceFailureSchema>;
const issue = z
  .object({
    number: iid,
    title: z.string(),
    body: z.string().nullable(),
    state: z.string(),
    url: z.string(),
    author: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
// Reuse the existing qualified details projection. Strip unconsumed snapshot
// fields before IPC; this hover neither forwards diagnostics nor invents checks.
const snapshot = z
  .object({
    resource: RepositoryResourceTargetSchema,
    prNumber: iid,
    details: NativeReviewDetailsSchema.extend({
      resource: RepositoryResourceTargetSchema,
    }).strict(),
  })
  .strip();
export const RepositoryResourceResultSchema = z
  .object({
    readLifetimeId: id,
    scope: ExecutionScopeSchema.strict(),
    revision: RepositoryContextRevisionSchema.strict(),
    target: RepositoryResourceTargetSchema,
    outcome: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('merge-request'), snapshot }).strict(),
      z.object({ kind: z.literal('issue'), issue }).strict(),
      z
        .object({
          kind: z.literal('failure'),
          code: RepositoryResourceFailureSchema,
          status: z.number().int().min(100).max(599).nullable(),
        })
        .strict(),
    ]),
    quota: z
      .object({
        resetAt: counter.nullable(),
        remaining: counter.nullable(),
        limit: counter.nullable(),
      })
      .strict(),
  })
  .strict();
export type RepositoryResourceResult = z.infer<typeof RepositoryResourceResultSchema>;
export const RepositoryResourceNoticeSchema = z
  .object({
    readLifetimeIds: z.array(id).max(64),
    sequence: counter,
    allRetired: z.boolean(),
    terminal: z.boolean(),
  })
  .strict();
export const RepositoryResourceRequestSchema = z
  .object({
    target: RepositoryResourceTargetSchema,
    refresh: z.boolean().optional(),
  })
  .strict();

export function isRepositoryResourceResultFor(
  value: RepositoryResourceResult,
  capture: RepositoryResourceCapture,
  target: RepositoryResourceTarget,
): boolean {
  if (
    value.readLifetimeId !== capture.readLifetimeId ||
    !sameExecutionScope(value.scope, capture.scope) ||
    value.revision.epoch !== capture.revision.epoch ||
    value.revision.sequence !== capture.revision.sequence ||
    reviewTargetKey(value.target) !== reviewTargetKey(target)
  )
    return false;
  const outcome = value.outcome;
  if (outcome.kind === 'failure') return true;
  if (outcome.kind !== target.kind) return false;
  const url = outcome.kind === 'issue' ? outcome.issue.url : outcome.snapshot.details.url;
  const parsed = parseGitLabResourceLink(url, capture.instances);
  if (!parsed || reviewTargetKey(parsed) !== reviewTargetKey(target)) return false;
  return outcome.kind === 'issue'
    ? outcome.issue.number === target.number
    : outcome.snapshot.prNumber === target.number &&
        reviewTargetKey(outcome.snapshot.resource) === reviewTargetKey(target) &&
        reviewTargetKey(outcome.snapshot.details.resource) === reviewTargetKey(target);
}

/** One original IPC/daemon lifetime; no resolved payload cache. */
export interface RepositoryResourceSession {
  readonly capture: RepositoryResourceCapture;
  onRetired(listener: () => void): () => void;
  detail(target: RepositoryResourceTarget, refresh?: boolean): Promise<RepositoryResourceResult>;
  release(): Promise<void>;
}
