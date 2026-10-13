import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { getPhysicalRequestCompletion } from '$shared/event-recovery/session';
/** Independent ordinary scopes may overlap; recovery owns an exclusive snapshot. */
type SnapshotLane = { active: Set<Promise<void>>; barrier?: Promise<void> };
const sessions = new WeakMap<object, Map<string, SnapshotLane>>();

export function trackWorktreeSnapshotRead<T>(
  key: string,
  read: () => Promise<T>,
  mode: 'ordinary' | 'recovery' = 'ordinary',
): Promise<T> {
  const session = rendererEventRecovery.capturePhysicalSessionIdentity();
  const lanes = sessions.get(session) ?? new Map<string, SnapshotLane>();
  sessions.set(session, lanes);
  const retire = rendererEventRecovery.captureRetirement(key);
  const observe = async (error: unknown): Promise<void> => {
    const code = (error as { rpcCode?: unknown } | null)?.rpcCode;
    if (code === -32003 || code === -32001) retire(error);
    const completion = await getPhysicalRequestCompletion(error);
    if (completion && !completion.retired) await Promise.all(completion.errors.map(observe));
  };
  const lane: SnapshotLane = lanes.get(key) ?? { active: new Set<Promise<void>>() };
  lanes.set(key, lane);
  const previous =
    mode === 'recovery'
      ? lane.active.size
        ? Promise.all([...lane.active])
        : undefined
      : lane.barrier;
  const invoke = () => {
    try {
      if (session !== rendererEventRecovery.capturePhysicalSessionIdentity())
        throw new Error('Worktree read physical session expired before dispatch');
      return Promise.resolve(read());
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const result = previous ? previous.then(invoke) : invoke();
  const settled = result.then(() => undefined, observe);
  lane.active.add(settled);
  if (mode === 'recovery') lane.barrier = settled;
  void settled.then(() => {
    lane.active.delete(settled);
    if (lane.barrier === settled) lane.barrier = undefined;
    if (!lane.active.size && lanes.get(key) === lane) lanes.delete(key);
  });
  return result;
}
