import { z } from 'zod';

// Prepared additive contract, protocol §5.50. Absence retains legacy behavior.
const decimalU64 = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((value) => /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 18446744073709551615n);
export const AgentPlacementSchema = z
  .object({
    target: z.enum(['local', 'remote']),
    checkout: z.enum(['shared', 'worktree', 'isolated']),
    os: z.enum(['linux', 'macos']).optional(),
    nodeId: z.string().min(1).optional(),
    exclusive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.target !== 'remote' || value.checkout === 'isolated')
  .refine(
    (value) => !value.exclusive || (value.target === 'remote' && value.checkout === 'isolated'),
  );
/** Prepared platform requests; an empty object is distinct from an omitted request. */
const AgentPlacementRequestShape = z
  .object({
    // `e2b` (cloud machines): a new sandbox; needs `cloudMachines: 1`.
    target: z.enum(['local', 'remote', 'e2b']).optional(),
    checkout: z.enum(['shared', 'worktree', 'isolated']).optional(),
    os: z.enum(['linux', 'macos']).optional(),
    arch: z.enum(['x86_64', 'aarch64']).optional(),
    nodeId: z
      .string()
      .min(1)
      .refine((id) => new TextEncoder().encode(id).length <= 128)
      .optional(),
    exclusive: z.boolean().optional(),
  })
  .strict();
export const AgentPlacementRequestSchema = AgentPlacementRequestShape.refine(
  (value) => value.target !== 'remote' || (value.checkout ?? 'isolated') === 'isolated',
)
  .refine(
    (value) =>
      value.target !== 'e2b' ||
      ((value.checkout ?? 'isolated') === 'isolated' &&
        !value.os &&
        !value.arch &&
        !value.nodeId &&
        !value.exclusive),
  )
  .refine(
    (value) =>
      !value.exclusive ||
      (value.target !== 'local' && (value.checkout ?? 'isolated') === 'isolated'),
  );
export type AgentPlacementRequest = z.infer<typeof AgentPlacementRequestSchema>;

/**
 * Agent projections include platform fields, but always resolve target and
 * checkout. A cloud agent's projection is read as reported (no request rules).
 */
const AgentResolvedPlacementSchema = AgentPlacementRequestShape.refine(
  (value) => value.target !== 'remote' || (value.checkout ?? 'isolated') === 'isolated',
)
  .refine(
    (value) =>
      !value.exclusive ||
      (value.target !== 'local' && (value.checkout ?? 'isolated') === 'isolated'),
  )
  .and(
    z.object({
      target: z.enum(['local', 'remote', 'e2b']),
      checkout: z.enum(['shared', 'worktree', 'isolated']),
    }),
  );

export const AgentCheckpointSchema = z.object({
  id: z.string().min(1),
  assignmentEpoch: decimalU64,
  captureRevision: decimalU64,
  capturedAt: z.string().datetime({ offset: true }),
  committedAt: z.string().datetime({ offset: true }),
});
/**
 * A remote agent's checkout setup on its machine (PROTOCOL `methods/nodes.md`
 * "Prepared checkout"). `output` and `outputTruncated` come from detail reads only.
 */
const RemoteSetupStatusSchema = z.object({
  state: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
  exitCode: z.number().int().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  output: z.string().optional(),
  outputTruncated: z.boolean().optional(),
});
export type RemoteSetupStatus = z.infer<typeof RemoteSetupStatusSchema>;

export const AgentNodeFieldsSchema = z.object({
  nodeId: z.string().min(1).optional(),
  leaseId: z.string().min(1).optional(),
  /** The remote machine's configured display name. */
  nodeName: z.string().min(1).optional(),
  placement: AgentResolvedPlacementSchema.optional(),
  effectiveIsolation: z
    .enum(['pending', 'isolated', 'shared', 'worktree', 'direct', 'cow'])
    .optional(),
  nodeState: z.enum(['ready', 'offline', 'incompatible', 'removed']).optional(),
  checkpoint: AgentCheckpointSchema.optional(),
  placementError: z.object({ code: z.string(), detail: z.string() }).optional(),
  /** Cloud machines: present while the agent's E2B sandbox starts. */
  cloudStart: z
    .object({ step: z.string().min(1) })
    .passthrough()
    .optional()
    .catch(undefined),
  // An unknown shape drops only `setup`, never the other placement fields.
  setup: RemoteSetupStatusSchema.optional().catch(undefined),
  // Opaque diagnostic text: never a frontend or head filesystem path.
  nodePath: z.string().optional(),
});
export type AgentNodeFields = z.infer<typeof AgentNodeFieldsSchema>;
export type AgentCheckpoint = z.infer<typeof AgentCheckpointSchema>;

export type AgentPlacement = z.infer<typeof AgentResolvedPlacementSchema>;
