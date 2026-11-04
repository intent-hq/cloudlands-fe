/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { setWorkspaceLabel } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { labelWorkspace, workspaceLabelsState } from '../../test/fixtures/workspace-labels-state';
import { warmImport } from '../../test/warm-import';
import { homeNewLabel } from './home-new-label.svelte';

warmImport(() => import('./HomeNewLabelHost.svelte'));

let dispose: (() => void) | undefined;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  homeNewLabel.close();
  dispose?.();
  dispose = undefined;
});

async function openHost() {
  dispose = store.init(
    workspaceLabelsState({
      workspaces: [labelWorkspace('ws-target'), labelWorkspace('ws-other', { label: 'For Later' })],
    }),
  );
  const dispatch = vi.spyOn(store, 'dispatch').mockImplementation(() => undefined as never);
  const expandGroup = vi.fn();
  const Host = (await import('./HomeNewLabelHost.svelte')).default;
  render(Host);
  expect(screen.queryByRole('dialog')).toBeNull();
  homeNewLabel.open({ workspaceId: 'ws-target', expandGroup, getHomeElement: () => null });
  const input = await screen.findByRole('textbox', { name: 'Name' });
  return { dispatch, expandGroup, input };
}

describe('HomeNewLabelHost', () => {
  it('assigns the new label to the requesting workspace and expands its group', async () => {
    const { dispatch, expandGroup, input } = await openHost();
    await fireEvent.input(input, { target: { value: 'Reading' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(setWorkspaceLabel('ws-target', 'Reading')),
    );
    expect(expandGroup).toHaveBeenCalledWith('label:Reading');
    expect(homeNewLabel.request).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('rejects a label already in use, ignoring case', async () => {
    const { dispatch, input } = await openHost();
    await fireEvent.input(input, { target: { value: 'for later' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('A label with this name already exists.')).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();

    // A valid name in an old dialog cannot become the new admission's intent.
    const retiredRequest = homeNewLabel.request!;
    const next = workspaceLabelsState({ workspaces: [labelWorkspace('ws-target')] });
    const nextDispose = store.init(next);
    const currentDispatch = vi
      .spyOn(store, 'dispatch')
      .mockImplementation(() => undefined as never);
    expect(retiredRequest.isCurrent()).toBe(false);
    await fireEvent.input(input, { target: { value: 'Reading' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(homeNewLabel.request).toBeNull());
    expect(currentDispatch).not.toHaveBeenCalledWith(setWorkspaceLabel('ws-target', 'Reading'));
    nextDispose();
  });

  it('closes without assigning on cancel', async () => {
    const { dispatch, expandGroup } = await openHost();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(homeNewLabel.request).toBeNull());
    expect(dispatch).not.toHaveBeenCalled();
    expect(expandGroup).not.toHaveBeenCalled();
  });
});
