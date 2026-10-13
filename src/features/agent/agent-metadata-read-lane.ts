import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { agentMetadataRecoveryKey } from './agent-recovery-keys';
import { drainAgentReadFailure } from './agent-recovery-read-lane';

/** Independent ordinary scopes may overlap; recovery owns an exclusive snapshot. */
type MetadataLane = { active: Set<Promise<void>>; barrier?: Promise<void> };
const sessions = new WeakMap<object, Map<string, MetadataLane>>();

export function trackAgentMetadataRead<T>(
  workspaceId: string,
  read: () => Promise<T>,
  mode: 'ordinary' | 'recovery' = 'ordinary',
): Promise<T> {
  const captured = rendererEventRecovery.captureAuthoritySelector();
  const metadata = captured(agentMetadataRecoveryKey(workspaceId));
  const workspace = captured(`agent-workspace-authority:${JSON.stringify([workspaceId])}`);
  const retire = () => {
    if (metadata.isCurrent() && workspace.isCurrent())
      rendererEventRecovery.retireWorkspace(workspaceId);
  };
  const identity = rendererEventRecovery.capturePhysicalSessionIdentity();
  const lanes = sessions.get(identity) ?? new Map<string, MetadataLane>();
  sessions.set(identity, lanes);
  const lane: MetadataLane = lanes.get(workspaceId) ?? { active: new Set<Promise<void>>() };
  lanes.set(workspaceId, lane);
  const previous =
    mode === 'recovery'
      ? lane.active.size
        ? Promise.all([...lane.active])
        : undefined
      : lane.barrier;
  const invoke = () => {
    try {
      return Promise.resolve(read());
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const result = previous ? previous.then(invoke) : invoke();
  const settled = result.then(
    () => undefined,
    // A point-read not-found is entity-scoped, never a workspace denial.
    (error: unknown) => drainAgentReadFailure(error, retire, false),
  );
  lane.active.add(settled);
  if (mode === 'recovery') lane.barrier = settled;
  void settled.then(() => {
    lane.active.delete(settled);
    if (lane.barrier === settled) lane.barrier = undefined;
    if (!lane.active.size && lanes.get(workspaceId) === lane) lanes.delete(workspaceId);
  });
  return result;
}
