import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import type { RendererRecoveryScope, RendererRecoveryHandle } from './renderer-event-recovery';
import type { StoreState } from '$store/renderer/types';
import { toTerminalTab } from '$lib/client/live/live-terminals-client';
import { trackTerminalRuntimeRead } from '$lib/client/live/terminal-runtime-recovery';
import {
  loadWorkspaceTerminals,
  removeTerminal,
} from '$store/renderer/slices/terminals/terminals-slice';
import { selectTerminalsForWorkspace } from '$store/renderer/slices/terminals/terminals-selectors';
import { selectWorkspaceActionContext } from '$store/renderer/slices/workspace/workspace-selectors';
import { selectHostRole } from '$store/renderer/slices/principal/principal-selectors';
import { selectMountedWorkspaceIds } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-selectors';
export const terminalsRecoveryKey = (workspaceId: string) =>
  `terminals:${JSON.stringify([workspaceId])}`;
interface RecoveryStore {
  getState(): StoreState;
  dispatch(action: { type: string }): unknown;
  subscribe(listener: () => void): () => void;
}
export function installTerminalListRecovery(scope: RendererRecoveryScope, store: RecoveryStore) {
  const authority = selectPrincipalActionContext.select(store.getState());
  const owners = new Map<string, { context: string; handle: RendererRecoveryHandle }>();
  let live = true,
    syncing = false;
  const clear = (id: string) => {
    for (const terminal of selectTerminalsForWorkspace.select(store.getState(), id))
      store.dispatch(removeTerminal(id, terminal.id));
  };
  const sync = () => {
    if (!live || syncing || !scope.isCurrent()) return;
    syncing = true;
    try {
      const state = store.getState(),
        mounted = new Set(selectMountedWorkspaceIds.select(state));
      if (selectPrincipalActionContext.select(state) !== authority) {
        live = false;
        for (const [id, owner] of owners) {
          owner.handle.dispose();
          clear(id);
        }
        owners.clear();
        return;
      }
      for (const id of new Set([
        ...Object.keys(state.terminals.workspaces),
        ...mounted,
        ...owners.keys(),
      ])) {
        const context =
          selectHostRole.select(state) === 'owner'
            ? selectWorkspaceActionContext.select(state, id)
            : null;
        let owner = owners.get(id);
        if (owner && context !== owner.context) {
          owner.handle.dispose();
          owners.delete(id);
          owner = undefined;
          clear(id);
        }
        if (!context) continue;
        if (!owner) {
          const handle = scope.registerResource({
            key: terminalsRecoveryKey(id),
            workspaceId: id,
            eventTypes: ['terminal:exit'],
            active: mounted.has(id),
            isCurrent: () =>
              live &&
              scope.isCurrent() &&
              selectHostRole.select(store.getState()) === 'owner' &&
              context === selectWorkspaceActionContext.select(store.getState(), id),
            read: (reader) =>
              trackTerminalRuntimeRead(id, async () => {
                if (!reader.lifetime.isCurrent())
                  throw new Error('Terminal list authority expired');
                const raw = await reader.request<unknown>('terminal.list', { workspaceId: id });
                const rows = Array.isArray(raw)
                  ? raw
                  : (raw as { terminals?: unknown[] })?.terminals;
                if (!Array.isArray(rows)) throw new Error('Invalid terminal list');
                const terminals = rows.map((row) => toTerminalTab(row, id));
                if (terminals.some((row) => row === null)) throw new Error('Invalid terminal row');
                return {
                  terminals: terminals.filter((row) => row !== null),
                  boot: !Array.isArray(raw)
                    ? (raw as { daemonBootId?: string }).daemonBootId
                    : undefined,
                };
              }),
            apply: ({ terminals, boot }) => {
              const present = new Set(terminals.map((row) => row.id));
              for (const terminal of selectTerminalsForWorkspace.select(store.getState(), id))
                if (!present.has(terminal.id)) store.dispatch(removeTerminal(id, terminal.id));
              store.dispatch(loadWorkspaceTerminals(id, terminals, null, boot));
            },
            invalidate: () => {},
            retire: () => {
              clear(id);
            },
          });
          owner = { context, handle };
          owners.set(id, owner);
        }
        owner.handle.setActive(mounted.has(id));
      }
    } finally {
      syncing = false;
    }
  };
  const off = store.subscribe(sync);
  sync();
  return () => {
    live = false;
    off();
    for (const owner of owners.values()) owner.handle.dispose();
    owners.clear();
  };
}
