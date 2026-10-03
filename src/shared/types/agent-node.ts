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
export const AgentPlacementRequestSchema = z
  .object({
    target: z.enum(['local', 'remote']).optional(),
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
  .strict()
  .refine((value) => value.target !== 'remote' || (value.checkout ?? 'isolated') === 'isolated')
  .refine(
    (value) =>
      !value.exclusive ||
      (value.target !== 'local' && (value.checkout ?? 'isolated') === 'isolated'),
  );
export type AgentPlacementRequest = z.infer<typeof AgentPlacementRequestSchema>;

export const AgentCheckpointSchema = z.object({
  id: z.string().min(1),
  assignmentEpoch: decimalU64,
  captureRevision: decimalU64,
  capturedAt: z.string().datetime({ offset: true }),
  committedAt: z.string().datetime({ offset: true }),
});
export const AgentNodeFieldsSchema = z.object({
  nodeId: z.string().min(1).optional(),
  leaseId: z.string().min(1).optional(),
  placement: AgentPlacementSchema.optional(),
  effectiveIsolation: z
    .enum(['pending', 'isolated', 'shared', 'worktree', 'direct', 'cow'])
    .optional(),
  nodeState: z.enum(['ready', 'offline', 'incompatible', 'removed']).optional(),
  checkpoint: AgentCheckpointSchema.optional(),
  placementError: z.object({ code: z.string(), detail: z.string() }).optional(),
  // Opaque diagnostic text: never a frontend or head filesystem path.
  nodePath: z.string().optional(),
});
export type AgentNodeFields = z.infer<typeof AgentNodeFieldsSchema>;
export type AgentCheckpoint = z.infer<typeof AgentCheckpointSchema>;

export type AgentPlacement = z.infer<typeof AgentPlacementSchema>;
