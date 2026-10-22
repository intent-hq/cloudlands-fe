import { describe, expect, it, vi } from 'vitest';

// Match GuestSessionsSettings: the store factory must load before selectors initialize.
vi.mock('$store/renderer/store', async () => {
  const { createGuestWorkflowTestStore } = await import('./guest-workflow-store');
  return { store: createGuestWorkflowTestStore() };
});

import { store } from '$store/renderer/store';
import { principalContextChanged } from '$store/renderer/slices/principal/principal-slice';
import {
  selectCanAdministerHost,
  selectPrincipalSnapshot,
} from '$store/renderer/slices/principal/principal-selectors';

describe('guest workflow mocked store boundary', () => {
  it('initializes an admitted owner and restores admission after reset', () => {
    expect(selectCanAdministerHost.select(store.state)).toBe(true);
    store.dispatch(principalContextChanged(null));
    expect(selectPrincipalSnapshot.select(store.state)).toBeNull();
    store.init();
    expect(selectCanAdministerHost.select(store.state)).toBe(true);
    expect(selectPrincipalSnapshot.select(store.state)).not.toBeNull();
  });
});
