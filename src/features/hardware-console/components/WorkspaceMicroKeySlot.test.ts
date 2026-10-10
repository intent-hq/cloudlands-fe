import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { store } from '$store/renderer/store';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import {
  hydrateHardwareConsoleKeyPins,
  pinWorkspaceToKey,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { createMockWorkspace } from '../../../test/factories/workspace.factory';
import { WorkspaceId } from '$shared/types/branded-ids';
import { UNASSIGNED_KEY_PIN } from '../assignment/key-assignment';
import WorkspaceMicroKeySlot from './WorkspaceMicroKeySlot.svelte';

const connected = writable(false);
vi.mock('../device/connection-status', () => ({ microConnectedReadable: () => connected }));
const workspaceId = WorkspaceId('numbered-workspace');
const otherId = WorkspaceId('unnumbered-workspace');
beforeEach(() => {
  store.init();
  connected.set(true);
  store.dispatch(
    replaceWorkspaceList([
      createMockWorkspace({ id: workspaceId }),
      createMockWorkspace({ id: otherId }),
    ]),
  );
  store.dispatch(
    hydrateHardwareConsoleKeyPins([workspaceId, ...Array(5).fill(UNASSIGNED_KEY_PIN)]),
  );
});
afterEach(cleanup);

it('shows resolved numbers, reacts to reassignment and hides while disconnected', async () => {
  render(WorkspaceMicroKeySlot, { workspaceId });
  expect(screen.getByTitle('Micro key 1').textContent?.trim()).toBe('1');
  store.dispatch(pinWorkspaceToKey(5, workspaceId));
  await waitFor(() => expect(screen.getByTitle('Micro key 6').textContent?.trim()).toBe('6'));
  connected.set(false);
  await waitFor(() => expect(screen.queryByTitle('Micro key 6')).toBeNull());
  expect(store.state.hardwareConsole.keyPins[5]).toBe(workspaceId);
  connected.set(true);
  await waitFor(() => expect(screen.getByTitle('Micro key 6')).toBeTruthy());
});

it('hides an unnumbered workspace and follows a changed workspace prop', async () => {
  const { rerender } = render(WorkspaceMicroKeySlot, { workspaceId: otherId });
  expect(screen.queryByTitle(/Micro key/)).toBeNull();
  await rerender({ workspaceId });
  await waitFor(() => expect(screen.getByTitle('Micro key 1')).toBeTruthy());
});
