import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  rendererEventRecovery,
  type RendererRecoveryScope,
  type RendererRecoveryHandle,
} from './renderer-event-recovery';
import type { StoreState } from '$store/renderer/types';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import type { SkillInfo } from '$store/renderer/slices/skills/skills-types';
import { setSkills } from '$store/renderer/slices/skills/skills-slice';
import { selectWorkspaceActionContext } from '$store/renderer/slices/workspace/workspace-selectors';
import { selectMountedWorkspaceIds } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-selectors';
import { runRecoveryRead } from '$lib/client/live/recovery-read-queue';
export const skillsRecoveryKey = (workspaceId: string) => `skills:${JSON.stringify([workspaceId])}`;
const demand = new Map<string, number>();
const listeners = new Set<() => void>();
const demandOwners = new Map<string, RendererRecoveryHandle>();
export function acquireSkillsRecoveryDemand(workspaceId: string) {
  demand.set(workspaceId, (demand.get(workspaceId) ?? 0) + 1);
  for (const listener of listeners) listener();
  const handle = demandOwners.get(workspaceId);
  let released = false;
  const remove = () => {
    const count = (demand.get(workspaceId) ?? 1) - 1;
    if (count) demand.set(workspaceId, count);
    else demand.delete(workspaceId);
    for (const listener of listeners) listener();
  };
  return () => {
    if (released) return;
    released = true;
    if (handle && (handle.status.stale || handle.status.running))
      void handle.whenSettled().then(remove);
    else remove();
  };
}
export function readSkillsWithRecovery<T>(
  workspaceId: string,
  receipt: RecoveryLifetime,
  read: () => Promise<T>,
) {
  const key = skillsRecoveryKey(workspaceId);
  return rendererEventRecovery.hasOwner(key)
    ? runRecoveryRead(key, receipt, 'ordinary', 'list', read)
    : read();
}
function normalizeSkills(raw: unknown): SkillInfo[] {
  if (
    !Array.isArray(raw) ||
    raw.some((row) => !row || typeof row.name !== 'string' || typeof row.location !== 'string')
  )
    throw new Error('Invalid skills snapshot');
  return raw.map((row): SkillInfo => ({
    name: row.name,
    description: row.description,
    location: row.location,
    scope: row.scope,
    ...(row.resourceDirectory ? { resourceDirectory: row.resourceDirectory } : {}),
  }));
}
interface RecoveryStore {
  getState(): StoreState;
  dispatch(action: { type: string }): unknown;
  subscribe(listener: () => void): () => void;
}
export function installSkillsRecovery(scope: RendererRecoveryScope, store: RecoveryStore) {
  const authority = selectPrincipalActionContext.select(store.getState());
  const owners = new Map<string, { context: string; handle: RendererRecoveryHandle }>();
  let live = true,
    syncing = false;
  const sync = () => {
    if (!live || syncing || !scope.isCurrent()) return;
    syncing = true;
    try {
      const state = store.getState();
      if (selectPrincipalActionContext.select(state) !== authority) {
        live = false;
        for (const [id, owner] of owners) {
          if (demandOwners.get(id) === owner.handle) demandOwners.delete(id);
          owner.handle.dispose();
          store.dispatch(setSkills(id, []));
        }
        owners.clear();
        return;
      }
      const mounted = new Set(selectMountedWorkspaceIds.select(state));
      for (const workspaceId of new Set([
        ...Object.keys(state.skills.byWorkspaceId),
        ...demand.keys(),
        ...owners.keys(),
      ])) {
        const context = selectWorkspaceActionContext.select(state, workspaceId);
        const active = mounted.has(workspaceId) || demand.has(workspaceId);
        let owner = owners.get(workspaceId);
        if (owner && owner.context !== context) {
          if (demandOwners.get(workspaceId) === owner.handle) demandOwners.delete(workspaceId);
          owner.handle.dispose();
          owners.delete(workspaceId);
          owner = undefined;
          store.dispatch(setSkills(workspaceId, []));
        }
        if (!context) continue;
        if (!owner) {
          const handle = scope.registerResource({
            key: skillsRecoveryKey(workspaceId),
            workspaceId,
            eventTypes: ['skills:changed'],
            active,
            isCurrent: () =>
              live &&
              scope.isCurrent() &&
              selectWorkspaceActionContext.select(store.getState(), workspaceId) === context,
            read: (reader) =>
              runRecoveryRead(
                skillsRecoveryKey(workspaceId),
                reader.lifetime,
                'recovery',
                'list',
                async () => {
                  const raw = await reader.request<unknown>('skill.list', { workspaceId });
                  return normalizeSkills(raw);
                },
              ),
            onEvent: async (_notification, receipt) => {
              try {
                const skills = await runRecoveryRead(
                  skillsRecoveryKey(workspaceId),
                  receipt,
                  'ordinary',
                  'list',
                  async () => normalizeSkills(await scope.request('skill.list', { workspaceId })),
                );
                receipt.commit(() => {
                  store.dispatch(setSkills(workspaceId, skills));
                });
              } catch {
                // The read lane retires canonical denial; transient failure keeps the cached roster.
              }
            },
            apply: (skills) => {
              store.dispatch(setSkills(workspaceId, skills));
            },
            invalidate: () => {},
            retire: () => {
              store.dispatch(setSkills(workspaceId, []));
            },
          });
          owner = { context, handle };
          owners.set(workspaceId, owner);
          demandOwners.set(workspaceId, handle);
        }
        owner.handle.setActive(active);
      }
    } finally {
      syncing = false;
    }
  };
  listeners.add(sync);
  const off = store.subscribe(sync);
  sync();
  return () => {
    live = false;
    off();
    listeners.delete(sync);
    for (const [id, owner] of owners) {
      if (demandOwners.get(id) === owner.handle) demandOwners.delete(id);
      owner.handle.dispose();
    }
    owners.clear();
  };
}
