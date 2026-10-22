import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  setWorkspaceEntity,
  removeWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  hydrateHardwareConsoleKeyPins,
  pinWorkspaceToKey,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { createMockWorkspace } from '../../../../test/factories/workspace.factory';
import { WorkspaceId } from '$shared/types/branded-ids';
import MicroKeySlotBadge from '../MicroKeySlotBadge.svelte';

const workspaceId = WorkspaceId('slot-test-workspace');
const occupantId = WorkspaceId('slot-test-occupant');

beforeEach(() => {
  appStore.init();
  appStore.dispatch(
    setWorkspaceEntity(createMockWorkspace({ id: workspaceId, title: 'This workspace' })),
  );
  appStore.dispatch(
    setWorkspaceEntity(createMockWorkspace({ id: occupantId, title: 'Other workspace' })),
  );
  appStore.dispatch(
    hydrateHardwareConsoleKeyPins([workspaceId, occupantId, null, null, null, null]),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  appStore.dispatch(hydrateHardwareConsoleKeyPins([null, null, null, null, null, null]));
  appStore.dispatch(removeWorkspaceEntity(workspaceId));
  appStore.dispatch(removeWorkspaceEntity(occupantId));
});

describe('MicroKeySlotBadge exclusive assignment', () => {
  it('exposes the pinned slot and occupied consequence, then dispatches the exact new slot', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    render(MicroKeySlotBadge, { workspaceId, slot: 0 });
    const trigger = screen.getByRole('button');
    await fireEvent.keyDown(trigger, { key: 'F10', shiftKey: true });
    const choices = screen.getAllByRole('menuitemradio');
    expect(choices).toHaveLength(6);
    expect(choices[0].getAttribute('aria-checked')).toBe('true');
    expect(choices[1].textContent).toContain('Other workspace');
    await fireEvent.click(choices[1]);
    expect(dispatch).toHaveBeenCalledWith(pinWorkspaceToKey(1, workspaceId));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('offers no assignment for an archived workspace even with a stale slot prop', async () => {
    appStore.dispatch(setWorkspaceEntity(createMockWorkspace({ id: workspaceId, archived: true })));
    render(MicroKeySlotBadge, { workspaceId, slot: 0 });
    await fireEvent.click(screen.getByRole('button'));
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
  });

  it('rejects a choice if the workspace was archived while the menu was open', async () => {
    render(MicroKeySlotBadge, { workspaceId, slot: 0 });
    await fireEvent.click(screen.getByRole('button'));
    const choice = screen.getAllByRole('menuitemradio')[1];
    appStore.dispatch(setWorkspaceEntity(createMockWorkspace({ id: workspaceId, archived: true })));
    const before = appStore.state.hardwareConsole;
    await fireEvent.click(choice);
    expect(appStore.state.hardwareConsole).toBe(before);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('drops the menu when its workspace changes', async () => {
    const { rerender } = render(MicroKeySlotBadge, { workspaceId, slot: 0 });
    await fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeTruthy();
    await rerender({ workspaceId: occupantId, slot: 1 });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});
