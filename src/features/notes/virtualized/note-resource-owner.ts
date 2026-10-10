import { v4 as uuid } from 'uuid';
import {
  pageResourcesRequested,
  pageResourcesReleased,
  pageResourcesTransferred,
} from '$store/renderer/slices/note-pages/note-pages-slice';
import type { NoteResourceCost, NoteResourceLedger } from './note-resource-ledger';

type Action =
  | ReturnType<typeof pageResourcesRequested>
  | ReturnType<typeof pageResourcesReleased>
  | ReturnType<typeof pageResourcesTransferred>;
interface ResourceStateAdapter {
  read(): NoteResourceLedger;
  dispatch(action: Action): unknown;
}
// This map provides allocation identity only. Redux is the sole credit/owner
// authority; weak keys never keep decoded pages or destroyed views alive.
const identities = new WeakMap<object, string>();

export function createNoteResourceOwner(state: ResourceStateAdapter) {
  const held = (owner: string, resource: string) => state.read().owners[owner]?.includes(resource);
  const release = (owner: string) => {
    state.dispatch(pageResourcesReleased(owner));
  };
  return {
    release,
    retain(owner: string, object: object, cost: NoteResourceCost) {
      const id = identities.get(object);
      if (!id || !Object.hasOwn(state.read().resources, id))
        throw new Error('Cannot retain an allocation without a live reservation');
      state.dispatch(pageResourcesRequested(owner, [{ id, cost }]));
      return held(owner, id) === true;
    },
    reservation(owner: string, suppliedCost: NoteResourceCost) {
      const id = uuid();
      const cost = { ...suppliedCost };
      let phase: 'reserved' | 'constructed' | 'closed' = 'reserved';
      const close = () => {
        if (phase === 'closed') return;
        release(owner);
        phase = 'closed';
      };
      return {
        /** No constructor runs until the reducer grants the complete reservation.
         * Failure cleanup must remove any partial native side effects before the
         * credit is released. Failed cleanup deliberately retains the reservation.
         */
        construct<T extends object>(create: () => T, cleanupFailure: () => void): T | undefined {
          if (phase !== 'reserved') throw new Error(`Note resource ticket is ${phase}`);
          state.dispatch(pageResourcesRequested(owner, [{ id, cost }]));
          if (!held(owner, id)) return undefined;
          try {
            const value = create();
            if (identities.has(value))
              throw new Error('Construction returned an existing allocation');
            identities.set(value, id);
            phase = 'constructed';
            return value;
          } catch (error) {
            cleanupFailure();
            close();
            throw error;
          }
        },
        release: close,
        /** Call after asynchronous DOM/plugin disposal, not just panel invalidation. */
        async disposeAfter(dispose: () => void | Promise<void>) {
          if (phase === 'closed') return;
          await dispose();
          close();
        },
        transfer(to: string) {
          if (phase !== 'constructed')
            throw new Error('Only a constructed allocation can transfer');
          state.dispatch(pageResourcesTransferred(owner, to));
          phase = 'closed';
        },
      };
    },
  };
}
