import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';

/** Independent ordinary scopes may overlap; recovery owns an exclusive snapshot. */
type MetadataLane = { active: Set<Promise<void>>; barrier?: Promise<void> };
const sessions = new WeakMap<object, Map<string, MetadataLane>>();

export function trackAgentMetadataRead<T>(
  workspaceId: string,
  read: () => Promise<T>,
  mode: 'ordinary' | 'recovery' = 'ordinary',
): Promise<T> {
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
    async (error: unknown) => {
      if (error instanceof RecoveryRequestTimeoutError) await error.drained;
    },
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
