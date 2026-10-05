import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import AgentRulesEditor from '$lib/components/settings/AgentRulesEditor.svelte';
import AIBehaviorEditor from '$lib/components/settings/AIBehaviorEditor.svelte';
import AIBehaviorSidebar from '$lib/components/settings/AIBehaviorSidebar.svelte';
import {
  setFileSpecialists,
  setBundledSpecialists,
} from '$store/renderer/slices/specialists/specialists-slice';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal, withHostPrincipal } from '../../test/fixtures/principal-state';
import {
  principalReceived,
  hostMembershipChanged,
} from '$store/renderer/slices/principal/principal-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { agentRulesSaga } from '$store/renderer/slices/user-preferences/sagas/agent-rules-saga';
import { specialistsSaga } from '$store/renderer/slices/specialists/sagas/specialists-saga';
import {
  agentRulesEditorOpened,
  agentRulesContentChanged,
  saveAgentRules,
  undoAgentRulesChanges,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  saveFileSpecialist,
  deleteFileSpecialist,
  updateSpecialistDraft,
  createSpecialistFromDraft,
} from '$store/renderer/slices/specialists/specialists-slice';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  success: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    settings: { getUserRule: mocks.get, updateUserRule: mocks.update },
    specialists: {
      create: mocks.create,
      edit: mocks.edit,
      delete: mocks.remove,
      list: mocks.list,
      subscribe: () => () => {},
    },
  },
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: mocks.success },
}));
const stops: Array<() => void> = [];
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(20);
  flushSync();
};
function admit(role: 'owner' | 'member' | 'guest') {
  if (!store.state.principal.context) admitLegacyPrincipal();
  const state = withHostPrincipal(store.state, role);
  state.principal.snapshot!.principal.hostMembershipRevision = Math.max(
    1,
    store.state.principal.minimumRevision,
  );
  store.dispatch(
    principalReceived(
      {
        context: state.principal.context!,
        invalidation: store.state.principal.invalidation,
        presentationVersion: store.state.principal.presentationVersion,
      },
      state.principal.snapshot!,
    ),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  stops.push(store.init());
  mocks.get.mockResolvedValue({ content: 'Host instructions' });
  mocks.update.mockResolvedValue({ success: true });
  mocks.create.mockResolvedValue({});
  mocks.edit.mockResolvedValue({});
  mocks.remove.mockResolvedValue({});
  mocks.list.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  stops
    .reverse()
    .splice(0)
    .forEach((stop) => stop());
  vi.useRealTimers();
});

describe('admitted authority for instance agent settings', () => {
  it.each(['member', 'guest'] as const)(
    'allows %s reads but rejects rules and specialist writes',
    async (role) => {
      admit(role);
      stops.push(store.runSaga(agentRulesSaga), store.runSaga(specialistsSaga));
      store.dispatch(agentRulesEditorOpened());
      await settle();
      expect(store.state.userPreferences.agentRulesEditor.content).toBe('Host instructions');
      store.dispatch(agentRulesContentChanged('unauthorized'));
      store.dispatch(saveAgentRules());
      store.dispatch(undoAgentRulesChanges());
      await vi.advanceTimersByTimeAsync(1500);
      expect(mocks.update).not.toHaveBeenCalled();
      const save = saveFileSpecialist({
        id: 'new',
        name: 'New',
        description: '',
        behaviorPrompt: 'unsafe',
      });
      store.dispatch(save);
      await expect(save.promise).rejects.toThrow();
      const remove = deleteFileSpecialist({ id: 'existing', scope: 'user' });
      store.dispatch(remove);
      await expect(remove.promise).rejects.toThrow();
      store.dispatch(updateSpecialistDraft('user', { name: 'New' }));
      const create = createSpecialistFromDraft('user');
      store.dispatch(create);
      await expect(create.promise).rejects.toThrow();
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.edit).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );
  it('drops a pending rules debounce on role invalidation and reloads for the admitted guest', async () => {
    admit('owner');
    stops.push(store.runSaga(agentRulesSaga));
    store.dispatch(agentRulesEditorOpened());
    await settle();
    store.dispatch(agentRulesContentChanged('owner draft'));
    store.dispatch(
      hostMembershipChanged({
        action: 'added',
        hostRole: 'guest',
        principalId: 'principal',
        revision: 2,
      }),
    );
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.update).not.toHaveBeenCalled();
    admit('guest');
    await settle();
    expect(store.state.userPreferences.agentRulesEditor.content).toBe('Host instructions');
  });
  it('ignores a stale rules read after reconnect without requiring the old request to settle', async () => {
    let resolve!: (value: { content: string }) => void;
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    admit('owner');
    stops.push(store.runSaga(agentRulesSaga));
    store.dispatch(agentRulesEditorOpened());
    store.dispatch(backendReconnected());
    admit('guest');
    await settle();
    expect(store.state.userPreferences.agentRulesEditor.content).toBe('Host instructions');
    resolve({ content: 'Old host private draft' });
    await settle();
    expect(store.state.userPreferences.agentRulesEditor.content).toBe('Host instructions');
  });
  it('does not claim specialist save success or refetch after a reconnect', async () => {
    let resolve!: (value: object) => void;
    mocks.create.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    admit('owner');
    stops.push(store.runSaga(specialistsSaga));
    const save = saveFileSpecialist({
      id: 'new',
      name: 'New',
      description: '',
      behaviorPrompt: 'draft',
    });
    store.dispatch(save);
    expect(mocks.create).toHaveBeenCalledOnce();
    store.dispatch(backendReconnected());
    admit('owner');
    resolve({});
    await expect(save.promise).rejects.toThrow();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});

describe('read-only settings controls with the real store', () => {
  it.each(['guest', 'member'] as const)(
    'lets an admitted %s browse and select text, including a create deep link',
    async (role) => {
      admit(role);
      store.dispatch(setBundledSpecialists([]));
      store.dispatch(
        setFileSpecialists([
          {
            id: 'review',
            name: 'Reviewer',
            description: 'Review changes',
            behaviorPrompt: 'Read the patch carefully.',
            model: 'gpt',
            reasoningEffort: 'high',
            modelOptions: [{ model: 'other', hint: 'For large changes' }],
            filePath: '/host/specialists/review.md',
            source: 'user',
          },
        ]),
      );
      const sidebar = render(AIBehaviorSidebar, {
        activeView: { type: 'specialist', id: 'review' },
        onSelect: vi.fn(),
      });
      expect(screen.getByRole('button', { name: 'Reviewer' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Create Specialist' })).toBeNull();
      const editor = render(AIBehaviorEditor, { activeView: { type: 'specialist', id: 'review' } });
      flushSync();
      const prompt = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(prompt.readOnly).toBe(true);
      expect(prompt.disabled).toBe(false);
      prompt.focus();
      prompt.setSelectionRange(0, 4);
      expect(prompt.value.slice(prompt.selectionStart, prompt.selectionEnd)).toBe('Read');
      expect(screen.queryByRole('button', { name: /Delete Specialist|Reset|Open/ })).toBeNull();
      await editor.rerender({ activeView: { type: 'create-specialist' } });
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.getByText('Only the instance owner can edit these settings.')).toBeTruthy();
      editor.unmount();
      sidebar.unmount();
    },
  );
  it('retains selectable rules and blocks keyboard save after owner authority is removed', async () => {
    admit('owner');
    stops.push(store.runSaga(agentRulesSaga));
    render(AgentRulesEditor);
    flushSync();
    await settle();
    flushSync();
    let input = screen.getByRole('textbox') as HTMLTextAreaElement;
    await fireEvent.input(input, { target: { value: 'Pending owner draft' } });
    admit('guest');
    await settle();
    flushSync();
    input = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('Host instructions');
    await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { principalContextChanged } from '$store/renderer/slices/principal/principal-slice';
import { refetchSpecialistsRequested } from '$store/renderer/slices/specialists/specialists-slice';

describe('queued operations across authority lifetimes', () => {
  it('withholds unknown reads and refuses direct mutation actions until admission', async () => {
    stops.push(store.runSaga(agentRulesSaga), store.runSaga(specialistsSaga));
    store.dispatch(agentRulesEditorOpened());
    store.dispatch(agentRulesContentChanged('unknown draft'));
    store.dispatch(saveAgentRules());
    const save = saveFileSpecialist({
      id: 'new',
      name: 'New',
      description: '',
      behaviorPrompt: '',
    });
    store.dispatch(save);
    await expect(save.promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    admit('owner');
    await settle();
    expect(store.state.userPreferences.agentRulesEditor.content).toBe('Host instructions');
  });
  it('abandons an in-flight rules write and queued undo when switching to another owner backend', async () => {
    let resolve!: (value: { success: boolean }) => void;
    mocks.update.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    admit('owner');
    stops.push(store.runSaga(agentRulesSaga));
    store.dispatch(agentRulesEditorOpened());
    await settle();
    store.dispatch(agentRulesContentChanged('old host draft'));
    store.dispatch(saveAgentRules());
    store.dispatch(undoAgentRulesChanges());
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'host-b', windowBackendId: 'host-b' }),
    );
    store.dispatch(principalContextChanged(null));
    mocks.get.mockResolvedValue({ content: 'New host instructions' });
    admit('owner');
    await settle();
    expect(store.state.userPreferences.agentRulesEditor.content).toBe('New host instructions');
    resolve({ success: true });
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(store.state.userPreferences.agentRulesEditor.saveStatus).toBe('idle');
  });
  it('cancels creation during catalog confirmation and discards its late catalog after role removal', async () => {
    let resolve!: (value: unknown[]) => void;
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    admit('owner');
    stops.push(store.runSaga(specialistsSaga));
    store.dispatch(updateSpecialistDraft('user', { name: 'Reviewer', behaviorPrompt: 'Review' }));
    const create = createSpecialistFromDraft('user');
    store.dispatch(create);
    const failure = expect(create.promise).rejects.toThrow();
    await settle();
    expect(store.state.specialists.creationByContext.user.status).toBe('refreshing');
    store.dispatch(
      hostMembershipChanged({
        action: 'removed',
        hostRole: 'guest',
        principalId: 'principal',
        revision: 2,
      }),
    );
    await failure;
    resolve([
      { id: 'reviewer', name: 'Reviewer', source: 'user', behaviorPrompt: 'Late old host text' },
    ]);
    await settle();
    expect(store.state.specialists.creationByContext).toEqual({});
    expect(mocks.success).not.toHaveBeenCalled();
    expect(getItems(store.state.specialists.fileSpecialists)).toEqual([]);
  });
  it('ignores an in-flight specialist refetch after the backend changes', async () => {
    let resolve!: (value: unknown[]) => void;
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    admit('guest');
    stops.push(store.runSaga(specialistsSaga));
    store.dispatch(refetchSpecialistsRequested());
    await vi.advanceTimersByTimeAsync(100);
    store.dispatch(backendReconnected());
    admit('guest');
    resolve([{ id: 'old', name: 'Old', source: 'user', behaviorPrompt: 'Old host text' }]);
    await settle();
    expect(getItems(store.state.specialists.fileSpecialists)).toEqual([]);
  });
});
