import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import {
  connectOperationFailed,
  keychainSyncStateReceived,
  openOperationStarted,
} from '$store/renderer/slices/connections/connections-slice';
import type { KeychainSyncStateResult } from '$store/renderer/slices/connections/connections-types';
import { preview } from './connect-backend-modal.preview.svelte';

describe('connect backend modal preview cleanup', () => {
  let disposeStore: () => void;

  beforeEach(() => {
    disposeStore = store.init();
  });

  afterEach(() => {
    disposeStore();
  });

  const populated: KeychainSyncStateResult = {
    supported: true,
    enabled: false,
    status: { state: 'active' },
  };

  it.each([
    { name: 'null', previous: null, scene: 'icloud', supported: true },
    { name: 'populated', previous: populated, scene: 'unsupported', supported: false },
  ])(
    'restores $name sync state without undoing unrelated changes',
    ({ previous, scene, supported }) => {
      if (previous !== null) store.dispatch(keychainSyncStateReceived(previous));
      store.dispatch(openOperationStarted('preview-pending-connection'));
      const before = store.state;
      let duringPreview = before;

      const dispose = preview.states[scene].setup?.();
      if (typeof dispose !== 'function') throw new Error('Preview setup must return a disposer');
      try {
        expect(store.state).toEqual({
          ...before,
          connections: {
            ...before.connections,
            keychainSync: { supported, enabled: supported, status: null },
          },
        });
        store.dispatch(connectOperationFailed('connection failed during preview'));
        duringPreview = store.state;
      } finally {
        dispose();
      }

      expect(store.state).toEqual({
        ...duringPreview,
        connections: { ...duringPreview.connections, keychainSync: previous },
      });
    },
  );
});
