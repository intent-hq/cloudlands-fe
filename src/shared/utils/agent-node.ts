import {
  AgentCheckpointSchema,
  AgentNodeFieldsSchema,
  type AgentCheckpoint,
  type AgentNodeFields,
} from '../types/agent-node';

/** Only a strictly newer epoch/revision may replace the durable checkpoint. */
export function currentAgentCheckpoint(
  existing: AgentCheckpoint | undefined,
  incoming: AgentCheckpoint | undefined,
): AgentCheckpoint | undefined {
  if (incoming && !AgentCheckpointSchema.safeParse(incoming).success) return existing;
  if (!existing || !incoming) return incoming ?? existing;
  const epoch = BigInt(incoming.assignmentEpoch) - BigInt(existing.assignmentEpoch);
  return epoch > 0n ||
    (epoch === 0n && BigInt(incoming.captureRevision) > BigInt(existing.captureRevision))
    ? incoming
    : existing;
}

/** Parse partial event projections; unrelated fields are deliberately ignored. */
export function agentNodeUpdates(data: unknown, existing?: AgentNodeFields): AgentNodeFields {
  const parsed = AgentNodeFieldsSchema.safeParse(data);
  if (!parsed.success) return {};
  const fields = parsed.data;
  if (fields.checkpoint)
    fields.checkpoint = currentAgentCheckpoint(existing?.checkpoint, fields.checkpoint);
  return fields;
}

/** Node-owned paths must never be resolved against the head workspace. */
export function hasNodeOwnedAgentPath(agent?: AgentNodeFields | null): boolean {
  return (
    !!agent &&
    (agent.placement?.target === 'remote' ||
      agent.placement?.checkout === 'isolated' ||
      agent.nodePath !== undefined)
  );
}
