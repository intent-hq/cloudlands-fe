/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { store } from '$store/renderer/store';
import { providerDefaultUpdateRequested } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import RemoteMenuPreview from './provider-remote-menu.preview.svelte';

vi.mock('svelte-fa', async () => ({
  default: (await import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const markItem = () => screen.getByTestId('provider-default-remote-item');

describe("the Default's remote options", () => {
  it('toggling the mark saves only remoteCompatible, keeping the name and overrides', async () => {
    store.init();
    const dispatch = vi.spyOn(store, 'dispatch');
    render(RemoteMenuPreview, { marked: false });
    await fireEvent.click(markItem());
    const saved = dispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === providerDefaultUpdateRequested.type);
    expect(saved?.payload).toMatchObject({ baseProviderId: 'claude-code', remoteCompatible: true });
    expect(saved?.payload.name).toBeUndefined();
    expect(saved?.payload.envRef).toBeUndefined();
  });

  it('cannot mark a Default that sets an account folder', () => {
    store.init();
    render(RemoteMenuPreview, { accountFolder: true });
    expect(
      markItem().getAttribute('aria-disabled') ?? markItem().getAttribute('data-disabled'),
    ).not.toBeNull();
  });

  it('shows machine sign-in only when the backend lists the setting; a missing entry reads on', async () => {
    store.init();
    const view = render(RemoteMenuPreview, { machineSignInSupported: false });
    await waitFor(() =>
      expect(screen.queryByTestId('provider-remote-machine-sign-in-item')).toBeNull(),
    );
    view.unmount();
    render(RemoteMenuPreview, {});
    await waitFor(() =>
      expect(
        screen.getByTestId('provider-remote-machine-sign-in-item').getAttribute('aria-checked'),
      ).toBe('true'),
    );
  });
});
