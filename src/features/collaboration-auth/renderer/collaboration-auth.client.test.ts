import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const labs = vi.hoisted(() => ({ multiplayer: false, dispatch: vi.fn() }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      userPreferences: { labsMultiplayerEnabled: labs.multiplayer },
    }),
    dispatch: labs.dispatch,
  });
});
import {
  collaborationAction,
  installCollaborationAuth,
  openCollaborationSignIn,
  syncCollaborationPolicy,
} from './collaboration-auth.client';
import { COLLABORATION_AUTH } from '../types';
let dispose: () => void;
const show = vi.fn();
const dismiss = vi.fn();
const api = () => window.electronAPI as any;
function emit(channel: string, payload: unknown) {
  for (const handler of api()._getRegisteredHandlers(channel)) handler(payload);
}
beforeEach(() => {
  labs.multiplayer = false;
  vi.clearAllMocks();
  dispose = installCollaborationAuth({ show, dismiss });
});
afterEach(() => dispose());
describe('collaboration entry and policy bridge', () => {
  it.each([false, true])(
    'Multiplayer=%s alone decides whether sign-in is exposed',
    (multiplayer) => {
      labs.multiplayer = multiplayer;
      openCollaborationSignIn();
      expect(
        api().invoke.mock.calls.some(([channel]: string[]) => channel === COLLABORATION_AUTH.OPEN),
      ).toBe(multiplayer);
      emit(COLLABORATION_AUTH.SHOW, { requestId: 'one', target: { provider: 'github' } });
      expect(show.mock.calls.length > 0).toBe(multiplayer);
      expect(api().invoke).toHaveBeenCalledWith(COLLABORATION_AUTH.POLICY, { multiplayer });
      if (!multiplayer)
        expect(labs.dispatch).toHaveBeenCalledWith(
          expect.objectContaining({ payload: ['Multiplayer'] }),
        );
    },
  );
  it('disabling while open hides the dialog and sends policy without revoking anything', async () => {
    labs.multiplayer = true;
    emit(COLLABORATION_AUTH.SHOW, { requestId: 'active' });
    api().invoke.mockClear();
    labs.multiplayer = false;
    syncCollaborationPolicy();
    await collaborationAction({ type: 'connect', token: 'private-pat' });
    expect(dismiss).toHaveBeenCalled();
    expect(api().invoke.mock.calls).toEqual([[COLLABORATION_AUTH.POLICY, { multiplayer: false }]]);
  });
});
