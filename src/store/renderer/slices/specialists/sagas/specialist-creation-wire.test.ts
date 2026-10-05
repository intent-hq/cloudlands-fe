import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import type { StoreAction, StoreState } from '../../../types';
import type { SpecialistDef } from '$lib/client/app-client';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(async () => ({ subscriptionId: 'creation-test' })),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveSpecialistsClient } = await import('$lib/client/live/live-specialists-client');
  return { appClient: { specialists: new LiveSpecialistsClient() } };
});
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { specialistsSaga } from './specialists-saga';
import {
  createSpecialistFromDraft,
  specialistsReducer,
  updateSpecialistDraft,
} from '../specialists-slice';
import { selectSpecialists } from '../specialists-selectors';

it('creates a user specialist through the real client and confirms the wire catalog before completion', async () => {
  let releaseWrite!: (value: SpecialistDef) => void;
  let releaseCatalog!: (value: { specialists: SpecialistDef[] }) => void;
  const write = new Promise<SpecialistDef>((resolve) => {
    releaseWrite = resolve;
  });
  const catalog = new Promise<{ specialists: SpecialistDef[] }>((resolve) => {
    releaseCatalog = resolve;
  });
  const create = vi.spyOn(appClient.specialists, 'create');
  let written = false;
  const request = vi.mocked(backendRequest).mockImplementation(async (method) => {
    if (method === 'specialist.create') {
      const result = await write;
      written = true;
      return { specialist: result };
    }
    if (method === 'specialist.list') return written ? catalog : { specialists: [] };
    throw new Error(`Unexpected method: ${method}`);
  });
  let specialists = specialistsReducer(undefined, { type: '@@init' });
  const channel = stdChannel();
  const state = () => withLegacyPrincipal({ specialists, githubAuth: { isAuthenticated: false } });
  const dispatch = (action: StoreAction<unknown>) => {
    specialists = specialistsReducer(specialists, action);
    channel.put(action);
  };
  const task = runSaga(
    {
      channel,
      dispatch,
      getState: state,
      context: {
        reduxStore: { getState: state, subscribe: () => () => {} },
        reportRuntimeError: (error: unknown) => {
          throw error;
        },
      },
    },
    specialistsSaga,
  );
  try {
    await vi.waitFor(() => expect(specialists.fileSpecialistsLoaded).toBe(true));
    dispatch(
      updateSpecialistDraft('user', {
        name: 'Wire reviewer',
        description: 'Reviews changes',
        codingAgent: 'codex',
        model: 'codex:gpt',
        reasoningEffort: 'high',
        behaviorPrompt: 'Review the changes.',
      }),
    );
    const action = createSpecialistFromDraft('user');
    dispatch(action);
    const spec = {
      id: 'wire-reviewer',
      name: 'Wire reviewer',
      description: 'Reviews changes',
      codingAgent: 'codex',
      model: 'gpt',
      reasoningEffort: 'high',
      behaviorPrompt: 'Review the changes.',
      source: 'user' as const,
    };
    expect(request).toHaveBeenCalledWith('specialist.create', {
      id: 'wire-reviewer',
      spec,
      scope: 'user',
    });
    expect(specialists.creationByContext.user.status).toBe('saving');
    releaseWrite(spec);
    await expect(create.mock.results[0].value).resolves.toEqual(spec);
    await vi.waitFor(() => expect(specialists.creationByContext.user.status).toBe('refreshing'));
    expect(request.mock.calls.filter(([method]) => method === 'specialist.list')).toEqual([
      ['specialist.list'],
      ['specialist.list'],
    ]);
    releaseCatalog({
      specialists: [{ ...spec, path: '/home/test/.intent/specialists/wire-reviewer.md' }],
    });
    await expect(action.promise).resolves.toBe('wire-reviewer');
    expect(selectSpecialists.select(state() as StoreState).map((entry) => entry.id)).toContain(
      'wire-reviewer',
    );
  } finally {
    task.cancel();
    await task.toPromise();
    create.mockRestore();
  }
});
