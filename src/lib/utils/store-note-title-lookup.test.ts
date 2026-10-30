import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetRendererStoreBridge,
  initRendererStoreBridge,
} from '$store/renderer/renderer-store-bridge';
import { storeNoteTitleLookup } from './store-note-title-lookup';

describe('storeNoteTitleLookup', () => {
  afterEach(() => _resetRendererStoreBridge());

  it('returns undefined before the store bridge is initialised', () => {
    expect(storeNoteTitleLookup('ws-1', 'n1')).toBeUndefined();
  });

  it('reads the current title through the store bridge', () => {
    const notes = { ids: ['n1'], map: { n1: { id: 'n1', title: 'Renamed meeting' } } };
    initRendererStoreBridge({
      state: { workspaceNotes: { byWorkspaceId: { 'ws-1': { notes } } } } as never,
      dispatch: () => undefined,
    });
    expect(storeNoteTitleLookup('ws-1', 'n1')).toBe('Renamed meeting');
    expect(storeNoteTitleLookup('ws-1', 'missing')).toBeUndefined();
    expect(storeNoteTitleLookup('ws-2', 'n1')).toBeUndefined();
  });
});
