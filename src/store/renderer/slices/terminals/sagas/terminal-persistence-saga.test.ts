import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  getItem: vi.fn(),
  setItem: vi.fn(),
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}));

vi.mock('$lib/utils/safe-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/safe-storage')>();
  return {
    ...actual,
    safeLocalStorage: {
      ...actual.safeLocalStorage,
      getItem: storage.getItem,
      setItem: storage.setItem,
      getJSON: storage.getJSON,
      setJSON: storage.setJSON,
    },
  };
});

import {
  CUSTOM_NAMES_STORAGE_KEY,
  STORAGE_KEY,
  WORKSPACE_STATE_STORAGE_KEY,
  addTerminal,
  closeTerminalOverlay,
  loadWorkspaceTerminals,
  openTerminalOverlay,
  removeTerminal,
  renameTerminal,
  saveTerminalMetadata,
  selectScript,
  selectTerminal,
  setTerminalOverlayHeight,
  setTerminalPlacement,
  terminalsReducer,
  toggleTerminalOverlay,
} from '../terminals-slice';
import { terminalPersistenceSaga } from './terminal-persistence-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function startSaga() {
  let terminals = terminalsReducer(undefined, { type: '@@init' } as never);
  const input = stdChannel();
  const dispatched: unknown[] = [];
  const dispatch = (action: unknown) => {
    dispatched.push(action);
    terminals = terminalsReducer(terminals, action as never);
    input.put(action as never);
    return action;
  };
  const task = runSaga(
    { channel: input, dispatch, getState: () => ({ terminals }) },
    terminalPersistenceSaga,
  );
  const send = (action: unknown) => {
    terminals = terminalsReducer(terminals, action as never);
    input.put(action as never);
  };
  return { dispatched, send, task, getTerminals: () => terminals };
}

const noHydratedPlacements = { type: 'terminals/hydratePlacements', payload: [{}] };

beforeEach(() => {
  storage.values.clear();
  vi.clearAllMocks();
  storage.getItem.mockImplementation((key: string) => storage.values.get(key) ?? null);
  storage.setItem.mockImplementation((key: string, value: string) => {
    storage.values.set(key, value);
  });
  storage.getJSON.mockImplementation((key: string) => {
    const value = storage.values.get(key);
    return value === undefined ? undefined : JSON.parse(value);
  });
  storage.setJSON.mockImplementation((key: string, value: unknown) => {
    storage.values.set(key, JSON.stringify(value));
  });
});

describe('terminalPersistenceSaga', () => {
  it('hydrates the legacy global height as the fallback before installing persistence watchers', async () => {
    storage.values.set(STORAGE_KEY, '64');
    const { dispatched, task } = startSaga();
    await settle();

    expect(dispatched).toEqual([
      { type: 'terminals/hydrateHeight', payload: [64, {}] },
      noHydratedPlacements,
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('uses the default height for missing and invalid persisted values', async () => {
    storage.values.set(STORAGE_KEY, 'invalid');
    const { dispatched, task } = startSaga();
    await settle();

    expect(dispatched).toEqual([
      { type: 'terminals/hydrateHeight', payload: [50, {}] },
      noHydratedPlacements,
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('hydrates stored placements per workspace at start, dropping malformed entries', async () => {
    storage.values.set(
      WORKSPACE_STATE_STORAGE_KEY,
      JSON.stringify({
        'ws-1': {
          isOpen: false,
          activeTerminalId: null,
          placements: { 'term-1': 'panel', 'script-1': 'overlay', bogus: 'floating' },
        },
        'ws-2': { isOpen: true, activeTerminalId: 'term-9' },
        'ws-3': { isOpen: false, activeTerminalId: null, placements: 'panel' },
      }),
    );
    const { dispatched, getTerminals, task } = startSaga();
    await settle();

    expect(dispatched).toEqual([
      { type: 'terminals/hydrateHeight', payload: [50, {}] },
      {
        type: 'terminals/hydratePlacements',
        payload: [{ 'ws-1': { 'term-1': 'panel', 'script-1': 'overlay' } }],
      },
    ]);
    expect(getTerminals().workspaces).toEqual({});
    task.cancel();
    await task.toPromise();
  });

  it('restores placements through the production load shape (terminals, null, bootId)', async () => {
    storage.values.set(
      WORKSPACE_STATE_STORAGE_KEY,
      JSON.stringify({
        'ws-1': {
          isOpen: false,
          activeTerminalId: null,
          placements: { 'term-1': 'panel', 'script-1': 'panel' },
        },
      }),
    );
    const { dispatched, getTerminals, send, task } = startSaga();
    await settle();
    dispatched.length = 0;
    storage.setJSON.mockClear();
    send(loadWorkspaceTerminals('ws-1', [{ id: 'term-1', name: 'Terminal 1' }], null, 'boot-1'));
    await settle();

    expect(dispatched).toEqual([]);
    expect(getTerminals().workspaces['ws-1'].placements).toEqual({
      'term-1': 'panel',
      'script-1': 'panel',
    });
    expect(getTerminals().workspacePlacements).toEqual({});
    expect(storage.setJSON.mock.calls).toEqual([
      [
        WORKSPACE_STATE_STORAGE_KEY,
        {
          'ws-1': {
            isOpen: false,
            activeTerminalId: 'term-1',
            placements: { 'term-1': 'panel', 'script-1': 'panel' },
          },
        },
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('does not clobber stored placements on a persist that precedes the first load', async () => {
    storage.values.set(
      WORKSPACE_STATE_STORAGE_KEY,
      JSON.stringify({
        'ws-1': { isOpen: false, activeTerminalId: null, placements: { 'term-1': 'panel' } },
      }),
    );
    const { getTerminals, send, task } = startSaga();
    await settle();
    send(addTerminal('ws-1', 'term-2'));
    await settle();

    expect(JSON.parse(storage.values.get(WORKSPACE_STATE_STORAGE_KEY) ?? '{}')).toEqual({
      'ws-1': { isOpen: false, activeTerminalId: 'term-2', placements: { 'term-1': 'panel' } },
    });

    send(setTerminalPlacement('ws-1', 'term-2', 'panel'));
    await settle();

    expect(JSON.parse(storage.values.get(WORKSPACE_STATE_STORAGE_KEY) ?? '{}')).toEqual({
      'ws-1': {
        isOpen: false,
        activeTerminalId: 'term-2',
        placements: { 'term-1': 'panel', 'term-2': 'panel' },
      },
    });

    send(
      loadWorkspaceTerminals(
        'ws-1',
        [
          { id: 'term-1', name: 'Terminal 1' },
          { id: 'term-2', name: 'Terminal 2' },
        ],
        null,
        'boot-1',
      ),
    );
    await settle();

    expect(getTerminals().workspaces['ws-1'].placements).toEqual({
      'term-1': 'panel',
      'term-2': 'panel',
    });
    task.cancel();
    await task.toPromise();
  });

  it('drops a stored placement removed before the first load instead of resurrecting it', async () => {
    storage.values.set(
      WORKSPACE_STATE_STORAGE_KEY,
      JSON.stringify({
        'ws-1': {
          isOpen: false,
          activeTerminalId: null,
          placements: { 'term-1': 'panel', 'script-1': 'panel' },
        },
      }),
    );
    const { getTerminals, send, task } = startSaga();
    await settle();
    send(addTerminal('ws-1', 'term-1'));
    send(removeTerminal('ws-1', 'term-1'));
    await settle();

    expect(JSON.parse(storage.values.get(WORKSPACE_STATE_STORAGE_KEY) ?? '{}')).toEqual({
      'ws-1': { isOpen: false, activeTerminalId: null, placements: { 'script-1': 'panel' } },
    });

    send(loadWorkspaceTerminals('ws-1', [], null, 'boot-1'));
    await settle();

    expect(getTerminals().workspaces['ws-1'].placements).toEqual({ 'script-1': 'panel' });
    expect(getTerminals().workspacePlacements['ws-1']).toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  it('hydrates per-workspace heights from workspace state and skips invalid ones', async () => {
    storage.values.set(STORAGE_KEY, '64');
    storage.values.set(
      WORKSPACE_STATE_STORAGE_KEY,
      JSON.stringify({
        'ws-1': { isOpen: true, activeTerminalId: 'term-1', height: 15 },
        'ws-2': { isOpen: false, activeTerminalId: null },
        'ws-3': { isOpen: false, activeTerminalId: null, height: 5 },
        'ws-4': { isOpen: false, activeTerminalId: null, height: 'tall' },
      }),
    );
    const { dispatched, task } = startSaga();
    await settle();

    expect(dispatched).toEqual([
      { type: 'terminals/hydrateHeight', payload: [64, { 'ws-1': 15 }] },
      noHydratedPlacements,
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('persists the post-reducer clamped height in the workspace state entry', async () => {
    storage.values.set(
      WORKSPACE_STATE_STORAGE_KEY,
      JSON.stringify({ 'ws-2': { isOpen: false, activeTerminalId: null, height: 30 } }),
    );
    const { send, task } = startSaga();
    await settle();
    storage.setJSON.mockClear();
    send(setTerminalOverlayHeight('ws-1', 100));
    await settle();
    send(setTerminalOverlayHeight('ws-1', 5));
    await settle();

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.setJSON.mock.calls).toEqual([
      [
        WORKSPACE_STATE_STORAGE_KEY,
        {
          'ws-1': { isOpen: false, activeTerminalId: null, height: 90 },
          'ws-2': { isOpen: false, activeTerminalId: null, height: 30 },
        },
      ],
      [
        WORKSPACE_STATE_STORAGE_KEY,
        {
          'ws-1': { isOpen: false, activeTerminalId: null, height: 10 },
          'ws-2': { isOpen: false, activeTerminalId: null, height: 30 },
        },
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('round-trips a workspace height through workspace-state storage', async () => {
    const first = startSaga();
    await settle();
    first.send(setTerminalOverlayHeight('ws-1', 25));
    await settle();
    first.task.cancel();
    await first.task.toPromise();

    const second = startSaga();
    await settle();

    expect(second.dispatched).toEqual([
      { type: 'terminals/hydrateHeight', payload: [50, { 'ws-1': 25 }] },
      noHydratedPlacements,
    ]);
    second.task.cancel();
    await second.task.toPromise();
  });

  it('keeps the workspace height when later overlay-state triggers persist', async () => {
    const { send, task } = startSaga();
    await settle();
    send(setTerminalOverlayHeight('ws-1', 25));
    await settle();
    storage.setJSON.mockClear();
    send(openTerminalOverlay('ws-1', 'term-1'));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      [
        WORKSPACE_STATE_STORAGE_KEY,
        {
          'ws-1': {
            isOpen: true,
            activeTerminalId: 'term-1',
            placements: { 'term-1': 'overlay' },
            height: 25,
          },
        },
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('merges a resize into the stored entry of a loaded workspace', async () => {
    const { send, task } = startSaga();
    await settle();
    send(openTerminalOverlay('ws-1', 'term-1'));
    await settle();
    storage.setJSON.mockClear();
    send(setTerminalOverlayHeight('ws-1', 35));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      [
        WORKSPACE_STATE_STORAGE_KEY,
        {
          'ws-1': {
            isOpen: true,
            activeTerminalId: 'term-1',
            placements: { 'term-1': 'overlay' },
            height: 35,
          },
        },
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('does not write storage for a non-finite height', async () => {
    const { send, task } = startSaga();
    await settle();
    storage.setJSON.mockClear();
    send(setTerminalOverlayHeight('ws-1', Number.NaN));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('keeps hydrated heights from exposing not-yet-loaded workspaces to persistence', async () => {
    const stored = {
      'ws-1': { isOpen: true, activeTerminalId: 'term-1', height: 15 },
      'ws-2': { isOpen: true, activeTerminalId: 'term-2' },
    };
    storage.values.set(WORKSPACE_STATE_STORAGE_KEY, JSON.stringify(stored));
    const { send, task } = startSaga();
    await settle();
    send(removeTerminal('ws-1', 'term-gone'));
    await settle();
    send(closeTerminalOverlay('ws-1'));
    await settle();
    send(removeTerminal('ws-2', 'term-gone'));
    await settle();

    const workspaceStateWrites = storage.setJSON.mock.calls.filter(
      ([key]) => key === WORKSPACE_STATE_STORAGE_KEY,
    );
    expect(workspaceStateWrites).toEqual([]);
    expect(JSON.parse(storage.values.get(WORKSPACE_STATE_STORAGE_KEY) ?? '{}')).toEqual(stored);
    task.cancel();
    await task.toPromise();
  });

  it('migrates legacy custom names and persists trimmed workspace names exactly', async () => {
    storage.values.set(
      CUSTOM_NAMES_STORAGE_KEY,
      JSON.stringify({ 'term-1': 'Old', 'term-2': 'Keep' }),
    );
    const { send, task } = startSaga();
    await settle();
    storage.setJSON.mockClear();
    send(renameTerminal('ws-1', 'term-1', '  Setup  '));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      [CUSTOM_NAMES_STORAGE_KEY, { __legacy__: { 'term-1': 'Old', 'term-2': 'Keep' } }],
      [
        CUSTOM_NAMES_STORAGE_KEY,
        { __legacy__: { 'term-2': 'Keep' }, 'ws-1': { 'term-1': 'Setup' } },
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('removes a custom-name bucket when the renamed value is blank', async () => {
    storage.values.set(CUSTOM_NAMES_STORAGE_KEY, JSON.stringify({ 'ws-1': { 'term-1': 'Setup' } }));
    const { send, task } = startSaga();
    await settle();
    storage.setJSON.mockClear();
    send(renameTerminal('ws-1', 'term-1', '   '));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([[CUSTOM_NAMES_STORAGE_KEY, {}]]);
    task.cancel();
    await task.toPromise();
  });

  it('persists metadata, retaining stored title and creation time on later blank updates', async () => {
    storage.values.set(
      'terminal-metadata-ws-1',
      JSON.stringify([
        {
          terminalId: 'term-1',
          workspaceId: 'ws-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          title: 'Setup',
        },
      ]),
    );
    const { send, task } = startSaga();
    await settle();
    storage.setJSON.mockClear();
    send(saveTerminalMetadata('ws-1', 'term-1', undefined, '2025-01-01T00:00:00.000Z'));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      [
        'terminal-metadata-ws-1',
        [
          {
            terminalId: 'term-1',
            workspaceId: 'ws-1',
            createdAt: '2024-01-01T00:00:00.000Z',
            title: 'Setup',
          },
        ],
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('filters invalid metadata before appending and caps the stored list at ten entries', async () => {
    storage.values.set(
      'terminal-metadata-ws-1',
      JSON.stringify([
        { terminalId: 'wrong', workspaceId: 'ws-2', createdAt: 'old' },
        ...Array.from({ length: 10 }, (_, index) => ({
          terminalId: `term-${index}`,
          workspaceId: 'ws-1',
          createdAt: `created-${index}`,
          title: `Title ${index}`,
        })),
      ]),
    );
    const { send, task } = startSaga();
    await settle();
    storage.setJSON.mockClear();
    send(saveTerminalMetadata('ws-1', 'term-10', 'Title 10', 'created-10'));
    await settle();

    const expectedValid = Array.from({ length: 10 }, (_, index) => ({
      terminalId: `term-${index}`,
      workspaceId: 'ws-1',
      createdAt: `created-${index}`,
      title: `Title ${index}`,
    }));
    expect(storage.setJSON.mock.calls).toEqual([
      ['terminal-metadata-ws-1', expectedValid],
      [
        'terminal-metadata-ws-1',
        [
          ...expectedValid.slice(1),
          {
            terminalId: 'term-10',
            workspaceId: 'ws-1',
            createdAt: 'created-10',
            title: 'Title 10',
          },
        ],
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('persists every overlay-state trigger from post-reducer workspace state', async () => {
    const { send, task } = startSaga();
    await settle();
    storage.setJSON.mockClear();
    send(openTerminalOverlay('ws-1', 'term-1'));
    await settle();
    send(closeTerminalOverlay('ws-1'));
    await settle();
    send(toggleTerminalOverlay('ws-1'));
    await settle();
    send(addTerminal('ws-1', 'term-2'));
    await settle();
    send(selectTerminal('ws-1', 'term-1'));
    await settle();
    send(selectScript('ws-1', 'script-1'));
    await settle();

    const placements = { 'term-1': 'overlay' };
    expect(storage.setJSON.mock.calls).toEqual([
      [
        WORKSPACE_STATE_STORAGE_KEY,
        { 'ws-1': { isOpen: true, activeTerminalId: 'term-1', placements } },
      ],
      [
        WORKSPACE_STATE_STORAGE_KEY,
        { 'ws-1': { isOpen: false, activeTerminalId: 'term-1', placements } },
      ],
      [
        WORKSPACE_STATE_STORAGE_KEY,
        { 'ws-1': { isOpen: true, activeTerminalId: 'term-1', placements } },
      ],
      [
        WORKSPACE_STATE_STORAGE_KEY,
        { 'ws-1': { isOpen: true, activeTerminalId: 'term-2', placements } },
      ],
      [
        WORKSPACE_STATE_STORAGE_KEY,
        { 'ws-1': { isOpen: true, activeTerminalId: 'term-1', placements } },
      ],
      [
        WORKSPACE_STATE_STORAGE_KEY,
        {
          'ws-1': {
            isOpen: true,
            activeTerminalId: 'term-1',
            placements: { ...placements, 'script-1': 'overlay' },
          },
        },
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('round-trips terminal placement through workspace-state persistence', async () => {
    const { dispatched, send, task } = startSaga();
    await settle();
    storage.setJSON.mockClear();
    send(setTerminalPlacement('ws-1', 'term-1', 'panel'));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      [
        WORKSPACE_STATE_STORAGE_KEY,
        { 'ws-1': { isOpen: false, activeTerminalId: null, placements: { 'term-1': 'panel' } } },
      ],
    ]);

    dispatched.length = 0;
    const terminals = [{ id: 'term-1', name: 'Terminal 1' }];
    send(loadWorkspaceTerminals('ws-1', terminals));
    await settle();

    expect(dispatched).toEqual([
      {
        type: 'terminals/loadWorkspaceTerminals',
        payload: [
          'ws-1',
          terminals,
          { isOpen: false, activeTerminalId: null, placements: { 'term-1': 'panel' } },
        ],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('cleans custom names and metadata before persisting removal state', async () => {
    storage.values.set(CUSTOM_NAMES_STORAGE_KEY, JSON.stringify({ 'ws-1': { 'term-1': 'Setup' } }));
    storage.values.set(
      'terminal-metadata-ws-1',
      JSON.stringify([
        {
          terminalId: 'term-1',
          workspaceId: 'ws-1',
          createdAt: 'created',
          title: 'Setup',
        },
      ]),
    );
    const { send, task } = startSaga();
    await settle();
    send(openTerminalOverlay('ws-1', 'term-1'));
    await settle();
    storage.setJSON.mockClear();
    send(removeTerminal('ws-1', 'term-1'));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      [CUSTOM_NAMES_STORAGE_KEY, {}],
      ['terminal-metadata-ws-1', []],
      [
        WORKSPACE_STATE_STORAGE_KEY,
        { 'ws-1': { isOpen: false, activeTerminalId: null, placements: {} } },
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('rehydrates a load without saved state and does not echo that hydration to storage', async () => {
    const savedState = { isOpen: true, activeTerminalId: 'term-2' };
    storage.values.set(WORKSPACE_STATE_STORAGE_KEY, JSON.stringify({ 'ws-1': savedState }));
    const { dispatched, send, task } = startSaga();
    await settle();
    dispatched.length = 0;
    storage.setJSON.mockClear();
    const terminals = [
      { id: 'term-1', name: 'Terminal 1' },
      { id: 'term-2', name: 'Terminal 2' },
    ];
    send(loadWorkspaceTerminals('ws-1', terminals));
    await settle();

    expect(dispatched).toEqual([
      {
        type: 'terminals/loadWorkspaceTerminals',
        payload: ['ws-1', terminals, savedState],
      },
    ]);
    expect(storage.setJSON.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('preserves explicit load state and persists its post-reducer result', async () => {
    storage.values.set(WORKSPACE_STATE_STORAGE_KEY, JSON.stringify({}));
    const { dispatched, send, task } = startSaga();
    await settle();
    dispatched.length = 0;
    storage.setJSON.mockClear();
    send(
      loadWorkspaceTerminals('ws-1', [{ id: 'term-1', name: 'Terminal 1' }], {
        isOpen: true,
        activeTerminalId: 'missing',
      }),
    );
    await settle();

    expect(dispatched).toEqual([]);
    expect(storage.setJSON.mock.calls).toEqual([
      [
        WORKSPACE_STATE_STORAGE_KEY,
        { 'ws-1': { isOpen: true, activeTerminalId: 'term-1', placements: {} } },
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores unrelated actions and workspace-state actions for missing workspaces', async () => {
    const { send, task } = startSaga();
    await settle();
    storage.setItem.mockClear();
    storage.setJSON.mockClear();
    send({ type: 'unrelated/action' });
    send(closeTerminalOverlay('missing'));
    await settle();

    expect(storage.setItem.mock.calls).toEqual([]);
    expect(storage.setJSON.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('swallows storage failures and keeps later persistence work alive', async () => {
    const { send, task } = startSaga();
    await settle();
    storage.setJSON.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    send(renameTerminal('ws-1', 'term-1', 'First'));
    await settle();
    storage.setJSON.mockImplementation((key: string, value: unknown) => {
      storage.values.set(key, JSON.stringify(value));
    });
    send(renameTerminal('ws-1', 'term-1', 'Second'));
    await settle();

    expect(JSON.parse(storage.values.get(CUSTOM_NAMES_STORAGE_KEY) ?? '{}')).toEqual({
      'ws-1': { 'term-1': 'Second' },
    });
    expect(task.isRunning()).toBe(true);
    task.cancel();
    await task.toPromise();
  });

  it('cancels pending hydration without a late dispatch and stops future writes', async () => {
    let resolveHeight!: (value: string | null) => void;
    storage.getItem.mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        resolveHeight = resolve;
      }),
    );
    const { dispatched, send, task } = startSaga();
    task.cancel();
    await task.toPromise();
    resolveHeight('70');
    await settle();
    send(setTerminalOverlayHeight('ws-1', 70));
    await settle();

    expect(dispatched).toEqual([]);
    expect(storage.setItem.mock.calls).toEqual([]);
    expect(storage.setJSON.mock.calls).toEqual([]);
  });
});
