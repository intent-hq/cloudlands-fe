import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import { UNASSIGNED_KEY_PIN } from '../key-assignment';

interface MockWorkspace {
  id: string;
  lastActivity: string;
  createdAt: string;
  updatedAt: string;
}

const emptyPins = (): (string | null)[] => [null, null, null, null, null, null];

const mockState = {
  workspace: {
    hasLoaded: true,
    workspaces: createCollection('id', [] as MockWorkspace[]),
  },
  hardwareConsole: {
    keyPins: emptyPins(),
    excludedWorkspaceIds: [] as string[],
    hydrated: false,
  },
};

const dispatched: { type: string; payload?: unknown[] }[] = [];

vi.mock('$store/renderer/store', () => ({
  store: {
    get state() {
      return mockState;
    },
    dispatch: vi.fn((action: { type: string; payload?: unknown[] }) => {
      dispatched.push(action);
      if (action.type === 'hardwareConsole/hydrateKeyPins') {
        const [pins, excluded] = action.payload ?? [];
        const next = emptyPins();
        (pins as (string | null)[])?.forEach((pin, slot) => {
          if (slot < 6 && typeof pin === 'string' && pin.length > 0) next[slot] = pin;
        });
        mockState.hardwareConsole.keyPins = next;
        mockState.hardwareConsole.excludedWorkspaceIds = (excluded as string[]) ?? [];
        mockState.hardwareConsole.hydrated = true;
      }
      if (action.type === 'hardwareConsole/keyPinsReconciled') {
        mockState.hardwareConsole.keyPins = (action.payload?.[0] as (string | null)[]).slice();
      }
      return action;
    }),
  },
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { appClient } from '$lib/client';
import { createHardwareConsoleKeyPinPersistenceMiddleware } from '../key-pin-persistence-service';

function ws(id: string, lastActivity: string): MockWorkspace {
  return { id, lastActivity, createdAt: '2026-01-01T00:00:00Z', updatedAt: lastActivity };
}

function seedWorkspaces(workspaces: MockWorkspace[]): void {
  mockState.workspace.workspaces = createCollection('id', workspaces);
}

function seedBag(bag: Record<string, unknown> | null): void {
  (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue(
    bag === null ? null : { path: 'hardwareConsole.state', value: bag },
  );
}

function lastPersistedValue(): Record<string, unknown> | undefined {
  const calls = (appClient.settings.update as ReturnType<typeof vi.fn>).mock.calls;
  if (calls.length === 0) return undefined;
  return calls[calls.length - 1][0][0].value as Record<string, unknown>;
}

beforeEach(() => {
  dispatched.length = 0;
  mockState.workspace = { hasLoaded: true, workspaces: createCollection('id', []) };
  mockState.hardwareConsole = {
    keyPins: emptyPins(),
    excludedWorkspaceIds: [],
    hydrated: false,
  };
  vi.clearAllMocks();
});

function invokeChain() {
  const middleware = createHardwareConsoleKeyPinPersistenceMiddleware();
  const next = vi.fn((action) => action);
  return middleware({} as never)(next);
}

describe('createHardwareConsoleKeyPinPersistenceMiddleware (sticky assignments)', () => {
  it('hydrates pins and the exclusion list from the bag', async () => {
    seedBag({ keyPins: ['ws-1'], excludedWorkspaceIds: ['ws-x'] });
    const invoke = invokeChain();

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual(
        expect.objectContaining({
          type: 'hardwareConsole/hydrateKeyPins',
          payload: [['ws-1', null, null, null, null, null], ['ws-x']],
        }),
      );
    });
  });

  it('snapshots the auto-filled layout into persisted pins after hydration (migration)', async () => {
    seedBag({ keyPins: [] });
    seedWorkspaces([ws('ws-new', '2026-07-30T00:00:00Z'), ws('ws-old', '2026-07-01T00:00:00Z')]);
    const invoke = invokeChain();

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual(
        expect.objectContaining({
          type: 'hardwareConsole/keyPinsReconciled',
          payload: [['ws-new', 'ws-old', null, null, null, null]],
        }),
      );
    });
    await vi.waitFor(() => {
      expect(lastPersistedValue()).toMatchObject({
        keyPins: ['ws-new', 'ws-old', null, null, null, null],
      });
    });
  });

  it('keeps assignments stable when workspace activity changes', async () => {
    seedBag({ keyPins: ['ws-a', 'ws-b'] });
    seedWorkspaces([ws('ws-a', '2026-07-01T00:00:00Z'), ws('ws-b', '2026-07-30T00:00:00Z')]);
    const invoke = invokeChain();

    invoke({ type: 'any/action' });
    await vi.waitFor(() => expect(mockState.hardwareConsole.hydrated).toBe(true));
    dispatched.length = 0;

    seedWorkspaces([ws('ws-a', '2026-07-01T00:00:00Z'), ws('ws-b', '2026-08-03T00:00:00Z')]);
    invoke({ type: 'workspace/updateWorkspaceEntity' });

    expect(
      dispatched.filter((a) => a.type === 'hardwareConsole/keyPinsReconciled'),
    ).toHaveLength(0);
    expect(mockState.hardwareConsole.keyPins).toEqual(['ws-a', 'ws-b', null, null, null, null]);
  });

  it('releases an archived workspace and backfills its slot', async () => {
    seedBag({ keyPins: ['ws-a', 'ws-b'] });
    seedWorkspaces([
      ws('ws-a', '2026-07-01T00:00:00Z'),
      ws('ws-b', '2026-07-02T00:00:00Z'),
      ws('ws-c', '2026-07-03T00:00:00Z'),
    ]);
    const invoke = invokeChain();

    invoke({ type: 'any/action' });
    await vi.waitFor(() => expect(mockState.hardwareConsole.hydrated).toBe(true));
    await vi.waitFor(() =>
      expect(mockState.hardwareConsole.keyPins).toEqual([
        'ws-a',
        'ws-b',
        'ws-c',
        null,
        null,
        null,
      ]),
    );
    (appClient.settings.update as ReturnType<typeof vi.fn>).mockClear();

    seedWorkspaces([ws('ws-b', '2026-07-02T00:00:00Z'), ws('ws-c', '2026-07-03T00:00:00Z')]);
    invoke({ type: 'workspace/removeWorkspaceEntity' });

    expect(mockState.hardwareConsole.keyPins).toEqual([null, 'ws-b', 'ws-c', null, null, null]);
    await vi.waitFor(() => {
      expect(lastPersistedValue()).toMatchObject({
        keyPins: [null, 'ws-b', 'ws-c', null, null, null],
      });
    });
  });

  it('excluded workspaces are never auto-filled back onto a key', async () => {
    seedBag({ keyPins: [], excludedWorkspaceIds: ['ws-x'] });
    seedWorkspaces([ws('ws-x', '2026-07-30T00:00:00Z'), ws('ws-a', '2026-07-01T00:00:00Z')]);
    const invoke = invokeChain();

    invoke({ type: 'any/action' });
    await vi.waitFor(() =>
      expect(mockState.hardwareConsole.keyPins).toEqual(['ws-a', null, null, null, null, null]),
    );
  });

  it('persists pins and exclusions together after a pin mutation', async () => {
    seedBag({ keyPins: [], sibling: 'kept' });
    seedWorkspaces([ws('ws-1', '2026-07-01T00:00:00Z')]);
    const invoke = invokeChain();

    invoke({ type: 'any/action' });
    await vi.waitFor(() => expect(mockState.hardwareConsole.hydrated).toBe(true));

    mockState.hardwareConsole.keyPins = ['ws-1', null, null, null, null, null];
    mockState.hardwareConsole.excludedWorkspaceIds = ['ws-x'];
    invoke({ type: 'hardwareConsole/pinWorkspaceToKey' });

    await vi.waitFor(() => {
      expect(lastPersistedValue()).toMatchObject({
        sibling: 'kept',
        keyPins: ['ws-1', null, null, null, null, null],
        excludedWorkspaceIds: ['ws-x'],
      });
    });
  });

  it('does not reconcile before the workspace list has loaded', async () => {
    seedBag({ keyPins: ['ws-a'] });
    mockState.workspace.hasLoaded = false;
    seedWorkspaces([]);
    const invoke = invokeChain();

    invoke({ type: 'any/action' });
    await vi.waitFor(() => expect(mockState.hardwareConsole.hydrated).toBe(true));
    invoke({ type: 'workspace/setWorkspaceLoading' });

    expect(
      dispatched.filter((a) => a.type === 'hardwareConsole/keyPinsReconciled'),
    ).toHaveLength(0);
    expect(mockState.hardwareConsole.keyPins).toEqual(['ws-a', null, null, null, null, null]);
  });

  it('does not reconcile when hydration failed', async () => {
    seedBag(null);
    seedWorkspaces([ws('ws-a', '2026-07-01T00:00:00Z')]);
    const invoke = invokeChain();

    invoke({ type: 'any/action' });
    await vi.waitFor(() => expect(mockState.hardwareConsole.hydrated).toBe(true));
    invoke({ type: 'workspace/updateWorkspaceEntity' });

    expect(
      dispatched.filter((a) => a.type === 'hardwareConsole/keyPinsReconciled'),
    ).toHaveLength(0);
    expect(appClient.settings.update).not.toHaveBeenCalled();
  });

  it('preserves sticky-unassigned sentinels through reconciliation', async () => {
    seedBag({ keyPins: [UNASSIGNED_KEY_PIN] });
    seedWorkspaces([ws('ws-a', '2026-07-01T00:00:00Z')]);
    const invoke = invokeChain();

    invoke({ type: 'any/action' });
    await vi.waitFor(() =>
      expect(mockState.hardwareConsole.keyPins).toEqual([
        UNASSIGNED_KEY_PIN,
        'ws-a',
        null,
        null,
        null,
        null,
      ]),
    );
  });
});
