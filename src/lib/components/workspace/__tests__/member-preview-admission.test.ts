import { afterEach, describe, expect, it, vi } from 'vitest';
import { store, initAppStore } from '$store/renderer/store';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { selectCanAdministerHost } from '$store/renderer/slices/principal/principal-selectors';
import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  principalReceived,
  hostMembershipChanged,
} from '$store/renderer/slices/principal/principal-slice';
import { setupListLabelsPreview } from '../list-labels.preview-fixtures';
import { setupFilesMenuFixture } from './files-open-menu.fixture';

let disposeRoot: (() => void) | undefined;
let cleanupFixture: (() => void) | undefined;
afterEach(() => {
  cleanupFixture?.();
  cleanupFixture = undefined;
  disposeRoot?.();
  disposeRoot = undefined;
});

describe('member preview admission ownership', () => {
  it.each(['files', 'list-labels'] as const)(
    'restores the borrowed guest admission after %s cleanup',
    (fixture) => {
      disposeRoot = initAppStore(store).dispose;
      admitLegacyPrincipal('guest');
      const snapshot = store.state.principal.snapshot!;
      store.dispatch(backendReconnected());
      store.dispatch(setLabsMultiplayerEnabled(true));
      store.dispatch(
        principalReceived(
          {
            context: store.state.principal.context!,
            invalidation: store.state.principal.invalidation,
            presentationVersion: store.state.principal.presentationVersion,
          },
          snapshot,
        ),
      );
      const previous = structuredClone(store.state.principal);
      cleanupFixture =
        fixture === 'files'
          ? setupFilesMenuFixture(vi.fn(), 'web', 16)
          : setupListLabelsPreview(false);
      expect(selectCanAdministerHost.select(store.state)).toBe(true);
      cleanupFixture();
      cleanupFixture = undefined;
      expect(store.state.principal).toEqual(previous);
      expect(selectCanAdministerHost.select(store.state)).toBe(false);
      store.dispatch(setLabsMultiplayerEnabled(true));
      expect(store.state.userPreferences.labsMultiplayerEnabled).toBe(true);
    },
  );

  it.each(['files', 'list-labels'] as const)(
    'restores the borrowed unknown admission after %s cleanup',
    (fixture) => {
      disposeRoot = initAppStore(store).dispose;
      const previous = structuredClone(store.state.principal);
      cleanupFixture =
        fixture === 'files'
          ? setupFilesMenuFixture(vi.fn(), 'web', 16)
          : setupListLabelsPreview(false);
      expect(selectCanAdministerHost.select(store.state)).toBe(true);
      cleanupFixture();
      cleanupFixture = undefined;
      expect(store.state.principal).toEqual(previous);
      expect(selectCanAdministerHost.select(store.state)).toBe(false);
      store.dispatch(setLabsMultiplayerEnabled(true));
      expect(store.state.userPreferences.labsMultiplayerEnabled).toBe(true);
    },
  );

  it('releases an owned list-labels root after clearing its fixture', () => {
    cleanupFixture = setupListLabelsPreview();
    expect(selectCanAdministerHost.select(store.state)).toBe(true);
    cleanupFixture();
    cleanupFixture = undefined;
    expect(() => store.state).toThrow();
  });

  for (const fixture of ['files', 'list-labels'] as const) {
    it.each(['reconnecting', 'revoked', 'stale-presentation'] as const)(
      `keeps a borrowed %s caller unchanged in ${fixture}`,
      (state) => {
        disposeRoot = initAppStore(store).dispose;
        admitLegacyPrincipal('guest');
        if (state === 'reconnecting') store.dispatch(backendReconnected());
        if (state === 'revoked')
          store.dispatch(
            hostMembershipChanged({
              revision: 1,
              principalId: store.state.principal.boundPrincipalId!,
              action: 'removed',
            }),
          );
        if (state === 'stale-presentation') store.dispatch(setLabsMultiplayerEnabled(false));
        const previous = structuredClone(store.state.principal);
        cleanupFixture =
          fixture === 'files'
            ? setupFilesMenuFixture(vi.fn(), 'web', 16)
            : setupListLabelsPreview(false);
        expect(store.state.principal).toEqual(previous);
        expect(selectCanAdministerHost.select(store.state)).toBe(false);
        cleanupFixture();
        cleanupFixture = undefined;
        expect(store.state.principal).toEqual(previous);
      },
    );

    it(`does not restore old admission after the parent reconnects during ${fixture}`, () => {
      disposeRoot = initAppStore(store).dispose;
      admitLegacyPrincipal('guest');
      cleanupFixture =
        fixture === 'files'
          ? setupFilesMenuFixture(vi.fn(), 'web', 16)
          : setupListLabelsPreview(false);
      store.dispatch(backendReconnected());
      const current = structuredClone(store.state.principal);
      cleanupFixture();
      cleanupFixture = undefined;
      expect(store.state.principal).toEqual(current);
      expect(selectCanAdministerHost.select(store.state)).toBe(false);
    });
  }
});
