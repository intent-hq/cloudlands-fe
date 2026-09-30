/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { store } from '$store/renderer/store';
import { WorkspaceId } from '$shared/types/branded-ids';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { principalContextChanged } from '$store/renderer/slices/principal/principal-slice';
import {
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import { selectEncoderEffortFeedback } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
import { setupEncoderEffortPreview } from '../encoder-effort.preview-fixture';
import Preview from '../encoder-effort.preview.svelte';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(() => {
    throw new Error('Display fixture must not request a backend');
  }),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

const workspaceId = WorkspaceId('encoder-preview-workspace');
const previousWorkspace = {
  id: workspaceId,
  title: 'Existing preview workspace',
  branch: 'existing',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatusEnum.Active,
  myRole: 'owner' as const,
  createdAt: '2026-09-25T00:00:00Z',
  updatedAt: '2026-09-25T00:00:00Z',
  lastActivity: '2026-09-25T00:00:00Z',
} satisfies Workspace;
let disposeStore: () => void;
let disposePreview: (() => void) | undefined;

beforeEach(() => {
  disposeStore = store.init();
});
afterEach(() => {
  cleanup();
  disposePreview?.();
  disposePreview = undefined;
  disposeStore();
});

async function mountPreview() {
  disposePreview = setupEncoderEffortPreview();
  render(Preview);
  await tick();
}
function highFeedback() {
  const status = screen.getByRole('status', { name: m.chat_effortPicker_title_label() });
  expect(status.textContent).toContain(m.chat_effortPicker_level_high());
  expect(screen.getByTestId('effort-picker-trigger').getAttribute('aria-label')).toBe(
    m.chat_effortPicker_trigger_ariaLabel({ level: m.chat_effortPicker_level_high() }),
  );
  expect(screen.getByTestId('effort-picker-trigger').hasAttribute('disabled')).toBe(true);
}

describe('encoder effort preview admission and lifetime', () => {
  it('renders the high feedback for its admitted workspace and releases its own row', async () => {
    await mountPreview();
    highFeedback();
    expect(selectEncoderEffortFeedback.select(store.state)?.target.workspaceId).toBe(workspaceId);
    cleanup();
    disposePreview?.();
    disposePreview = undefined;
    expect(selectWorkspaceById.select(store.state, workspaceId)).toBeUndefined();
    expect(selectEncoderEffortFeedback.select(store.state)).toBeNull();
  });

  it('restores an existing row and preserves unrelated workspace data', async () => {
    const unrelated = { ...previousWorkspace, id: WorkspaceId('unrelated-preview-workspace') };
    store.dispatch(setWorkspaceEntity(previousWorkspace));
    store.dispatch(setWorkspaceEntity(unrelated));
    await mountPreview();
    highFeedback();
    cleanup();
    disposePreview?.();
    disposePreview = undefined;
    expect(selectWorkspaceById.select(store.state, workspaceId)).toEqual(previousWorkspace);
    expect(selectWorkspaceById.select(store.state, unrelated.id)).toEqual(unrelated);
  });

  it('preserves an existing workspace denial during setup and teardown', async () => {
    const denied = { ...previousWorkspace, myRole: 'collaborator' as const };
    store.dispatch(setWorkspaceEntity(denied));
    await mountPreview();
    expect(selectWorkspaceById.select(store.state, workspaceId)).toEqual(denied);
    expect(selectEncoderEffortFeedback.select(store.state)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    disposePreview?.();
    disposePreview = undefined;
    expect(selectWorkspaceById.select(store.state, workspaceId)).toEqual(denied);
  });

  it.each(['missing row', 'collaborator', 'unknown principal', 'guest principal'] as const)(
    'withdraws feedback for %s without inventing management rights',
    async (denial) => {
      // This reachable starting row also isolates the unchanged-source causal control.
      store.dispatch(setWorkspaceEntity(previousWorkspace));
      await mountPreview();
      highFeedback();
      if (denial === 'missing row') store.dispatch(removeWorkspaceEntity(workspaceId));
      else if (denial === 'collaborator')
        store.dispatch(setWorkspaceEntity({ ...previousWorkspace, myRole: 'collaborator' }));
      else if (denial === 'unknown principal') store.dispatch(principalContextChanged(null));
      else admitLegacyPrincipal('guest');
      await waitFor(() => {
        expect(selectEncoderEffortFeedback.select(store.state)).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
      });
      expect(screen.getByTestId('effort-picker-trigger').hasAttribute('disabled')).toBe(true);
    },
  );
});
