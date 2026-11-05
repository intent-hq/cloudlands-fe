import {
  AgentCheckpointSchema,
  AgentNodeFieldsSchema,
  type AgentCheckpoint,
  type AgentNodeFields,
  type RemoteSetupStatus,
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

const SETUP_FINISHED = new Set(['completed', 'failed', 'skipped']);

/**
 * Rows and deltas omit setup output; only detail reads carry it. Keep the
 * known output until another setup run is reported: a different `startedAt`,
 * or an unfinished state after a finished one (a fresh launch).
 */
export function currentRemoteSetup(
  existing: RemoteSetupStatus | undefined,
  incoming: RemoteSetupStatus | undefined,
): RemoteSetupStatus | undefined {
  if (!incoming || incoming.output !== undefined || existing?.output === undefined) return incoming;
  const otherStart =
    existing.startedAt !== undefined &&
    incoming.startedAt !== undefined &&
    incoming.startedAt !== existing.startedAt;
  const relaunched = SETUP_FINISHED.has(existing.state) && !SETUP_FINISHED.has(incoming.state);
  if (otherStart || relaunched) return incoming;
  return {
    ...incoming,
    output: existing.output,
    ...(existing.outputTruncated !== undefined
      ? { outputTruncated: existing.outputTruncated }
      : {}),
  };
}

/** Parse partial event projections; unrelated fields are deliberately ignored. */
export function agentNodeUpdates(data: unknown, existing?: AgentNodeFields): AgentNodeFields {
  const parsed = AgentNodeFieldsSchema.safeParse(data);
  if (!parsed.success) return {};
  const fields = parsed.data;
  if (fields.setup === undefined) delete fields.setup;
  if (fields.checkpoint)
    fields.checkpoint = currentAgentCheckpoint(existing?.checkpoint, fields.checkpoint);
  if (fields.setup) fields.setup = currentRemoteSetup(existing?.setup, fields.setup);
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
