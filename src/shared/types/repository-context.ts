/**
 * Internal repository-context contract, mirrored from intent-core's
 * repository_context DTOs. This does not advertise or register a daemon RPC.
 * Canonical instance/project resolution and admission belong to the daemon.
 */
import { z } from 'zod';

const identifier = z.string().min(1);
// Core v2: exact u64 decimal strings. Never coerce numbers or store bigint in Redux.
const counter = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine(
    (value) => value.length < 20 || (value.length === 20 && value <= '18446744073709551615'),
    'Expected a canonical u64 decimal string',
  );

export const RepositoryTargetSchema = z.object({
  provider: z.enum(['github', 'gitlab']),
  instanceBaseUrl: identifier,
  projectPath: identifier,
});
export type RepositoryTarget = z.infer<typeof RepositoryTargetSchema>;

export const ReviewTargetSchema = z.object({
  repository: RepositoryTargetSchema,
  kind: z.enum(['pull-request', 'merge-request', 'issue']),
  number: z.number().int().positive().safe(),
});
export type ReviewTarget = z.infer<typeof ReviewTargetSchema>;

export const ExecutionScopeSchema = z.object({
  daemonId: identifier,
  authorityScopeId: identifier,
  authorityGeneration: counter,
});
export type ExecutionScope = z.infer<typeof ExecutionScopeSchema>;

export const RepositoryConnectionScopeSchema = z.object({
  connectionId: identifier,
  accountId: identifier,
  connectionGeneration: counter,
});
export type RepositoryConnectionScope = z.infer<typeof RepositoryConnectionScopeSchema>;

export const RepositoryContextRevisionSchema = z.object({
  epoch: identifier,
  sequence: counter,
});
export type RepositoryContextRevision = z.infer<typeof RepositoryContextRevisionSchema>;

export const RepositoryRootIdentitySchema = z.discriminatedUnion('kind', [
  z.object({ workspaceId: identifier, kind: z.literal('primary') }),
  z.object({ workspaceId: identifier, kind: z.literal('registered'), gitRootId: identifier }),
]);
export type RepositoryRootIdentity = z.infer<typeof RepositoryRootIdentitySchema>;

const EndpointResolutionSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('resolved'), target: RepositoryTargetSchema }),
  z.object({
    state: z.literal('unresolved'),
    reason: z.enum([
      'unknown-instance',
      'unsupported-transport',
      'ambiguous-mapping',
      'invalid-remote',
    ]),
  }),
]);
const EndpointSchema = z.object({ url: z.string(), resolution: EndpointResolutionSchema });

export const RepositorySavedChoiceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('automatic') }),
  z.object({ mode: z.literal('explicit-remote'), remoteName: identifier }),
  z.object({
    mode: z.literal('migrated-canonical'),
    target: RepositoryTargetSchema,
    provenance: z.object({
      source: z.enum(['workspace-metadata', 'registered-root-metadata']),
      recordId: identifier,
      resolverVersion: identifier,
      evidenceId: identifier,
    }),
  }),
  z.object({
    mode: z.literal('unresolved-historical'),
    source: z.enum(['workspace-metadata', 'registered-root-metadata']).optional(),
    recordId: z.string().optional(),
  }),
]);

export const RepositorySelectionSchema = z.object({
  saved: RepositorySavedChoiceSchema,
  noRemotes: z.boolean(),
  outcome: z.discriminatedUnion('state', [
    z.object({
      state: z.literal('resolved'),
      target: RepositoryTargetSchema,
      source: z.enum(['automatic', 'explicit-call', 'explicit-remote', 'migrated-canonical']),
    }),
    z.object({
      state: z.literal('selection-required'),
      reason: z.enum([
        'ambiguous-targets',
        'unresolved-candidates',
        'missing-selected-remote',
        'unresolved-historical-choice',
      ]),
    }),
    z.object({
      state: z.literal('repository-unavailable'),
      reason: z.literal('no-remote'),
      selectionRequired: z.boolean(),
    }),
  ]),
});

export const RepositoryAvailabilitySchema = z.enum([
  'connected',
  'disconnected',
  'disabled',
  'unsupported',
  'unknown',
]);
export type RepositoryAvailability = z.infer<typeof RepositoryAvailabilitySchema>;

export const RepositoryCapabilitySchema = z.object({
  operation: z.enum(['read-review', 'read-issue', 'create-review', 'clone', 'fetch', 'push']),
  state: z.enum(['available', 'unavailable', 'unknown']),
});
export type RepositoryCapability = z.infer<typeof RepositoryCapabilitySchema>;

export const RepositoryRootContextSchema = z.object({
  root: RepositoryRootIdentitySchema,
  branch: z.string().optional(),
  headSha: z.string().optional(),
  remotes: z.array(
    z.object({ name: identifier, fetch: z.array(EndpointSchema), push: z.array(EndpointSchema) }),
  ),
  targets: z.array(
    z.object({
      target: RepositoryTargetSchema,
      providerProjectId: identifier.optional(),
      connection: RepositoryConnectionScopeSchema.optional(),
      availability: RepositoryAvailabilitySchema,
      capabilities: z.array(RepositoryCapabilitySchema),
    }),
  ),
  reviewSelection: RepositorySelectionSchema,
});
export type RepositoryRootContext = z.infer<typeof RepositoryRootContextSchema>;

export const RepositoryContextSchema = z.object({
  revision: RepositoryContextRevisionSchema,
  scope: ExecutionScopeSchema,
  roots: z.array(RepositoryRootContextSchema),
});
export type RepositoryContext = z.infer<typeof RepositoryContextSchema>;

/** Renderer correlation only, never serialized as authorization on the wire. */
export interface RepositoryContextRequest {
  requestId: string;
  binding: string;
  workspaceId: string;
  gitRootId?: string;
}

export interface RepositoryContextResponse {
  request: RepositoryContextRequest;
  context: RepositoryContext;
}

/** A filtered response must belong to the workspace/root that was requested. */
export function isRepositoryContextForRequest(
  context: RepositoryContext,
  request: Pick<RepositoryContextRequest, 'workspaceId' | 'gitRootId'>,
): boolean {
  const keys = context.roots.map((entry) => repositoryRootKey(entry.root));
  return (
    (request.gitRootId === undefined || context.roots.length === 1) &&
    new Set(keys).size === keys.length &&
    context.roots.every(
      ({ root }) =>
        root.workspaceId === request.workspaceId &&
        (request.gitRootId === undefined ||
          (root.kind === 'registered' && root.gitRootId === request.gitRootId)),
    )
  );
}

/** Tuple encodings prevent delimiter collisions; never normalize canonical data here. */
export function repositoryTargetKey(target: RepositoryTarget): string {
  return JSON.stringify([target.provider, target.instanceBaseUrl, target.projectPath]);
}

export function reviewTargetKey(target: ReviewTarget): string {
  return JSON.stringify([repositoryTargetKey(target.repository), target.kind, target.number]);
}

export function executionScopeKey(scope: ExecutionScope): string {
  return JSON.stringify([scope.daemonId, scope.authorityScopeId, scope.authorityGeneration]);
}

export function repositoryConnectionScopeKey(scope: RepositoryConnectionScope): string {
  return JSON.stringify([scope.connectionId, scope.accountId, scope.connectionGeneration]);
}

export function sameExecutionScope(left: ExecutionScope, right: ExecutionScope): boolean {
  return executionScopeKey(left) === executionScopeKey(right);
}

export function sameRepositoryConnectionScope(
  left: RepositoryConnectionScope,
  right: RepositoryConnectionScope,
): boolean {
  return repositoryConnectionScopeKey(left) === repositoryConnectionScopeKey(right);
}

export function repositoryRootKey(root: RepositoryRootIdentity): string {
  return JSON.stringify([
    root.workspaceId,
    root.kind,
    root.kind === 'registered' ? root.gitRootId : null,
  ]);
}

/** Different authority scopes or daemon epochs are replacements, never ordered counters. */
export function compareRepositoryContextRevisions(
  left: Pick<RepositoryContext, 'scope' | 'revision'>,
  right: Pick<RepositoryContext, 'scope' | 'revision'>,
): -1 | 0 | 1 | null {
  if (
    !sameExecutionScope(left.scope, right.scope) ||
    left.revision.epoch !== right.revision.epoch
  ) {
    return null;
  }
  const a = left.revision.sequence;
  const b = right.revision.sequence;
  return a === b ? 0 : a.length < b.length || (a.length === b.length && a < b) ? -1 : 1;
}
