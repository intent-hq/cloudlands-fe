import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('$lib/utils/safe-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/safe-storage')>();
  return {
    ...actual,
    safeLocalStorage: {
      ...actual.safeLocalStorage,
      getItem: storage.getItem,
      setItem: storage.setItem,
    },
  };
});

import {
  externalEditorsReducer,
  fetchEditorsSuccess,
  setEditorOrder,
  setOpenAction,
  toggleHiddenEditor,
} from '../external-editors-slice';
import {
  EDITOR_ORDER_STORAGE_KEY,
  externalEditorsPersistenceSaga,
} from './external-editors-persistence-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function startSaga() {
  let externalEditors = externalEditorsReducer(undefined, { type: '@@init' } as never);
  const input = stdChannel();
  const dispatched: unknown[] = [];
  const dispatch = (action: unknown) => {
    dispatched.push(action);
    externalEditors = externalEditorsReducer(externalEditors, action as never);
    input.put(action as never);
    return action;
  };
  const task = runSaga(
    { channel: input, dispatch, getState: () => ({ externalEditors }) },
    externalEditorsPersistenceSaga,
  );
  const send = (action: unknown) => {
    externalEditors = externalEditorsReducer(externalEditors, action as never);
    input.put(action as never);
  };
  return { dispatched, send, task };
}

beforeEach(() => {
  vi.clearAllMocks();
  storage.getItem.mockReturnValue(null);
  storage.setItem.mockImplementation(() => undefined);
});

describe('externalEditorsPersistenceSaga', () => {
  it('hydrates normalized hidden editor IDs before installing persistence watchers', async () => {
    storage.getItem.mockReturnValueOnce(JSON.stringify(['vscode', 3, 'vscode', 'zed']));
    const { dispatched, task } = startSaga();
    await settle();

    expect(dispatched).toEqual([
      { type: 'externalEditors/setHiddenEditorIds', payload: [['vscode', 'zed']] },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('does not dispatch hydration for missing or invalid stored JSON', async () => {
    storage.getItem.mockReturnValueOnce('{invalid');
    const { dispatched, task } = startSaga();
    await settle();

    expect(dispatched).toEqual([]);
    expect(task.isRunning()).toBe(true);
    task.cancel();
    await task.toPromise();
  });

  it('hydrates a normalized editor ID order', async () => {
    storage.getItem.mockImplementation((key: string) =>
      key === EDITOR_ORDER_STORAGE_KEY ? JSON.stringify(['zed', 3, 'zed', 'vscode']) : null,
    );
    const { dispatched, task } = startSaga();
    await settle();

    expect(dispatched).toEqual([
      { type: 'externalEditors/setEditorOrder', payload: [['zed', 'vscode']] },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores malformed editor order storage safely', async () => {
    storage.getItem.mockImplementation((key: string) =>
      key === EDITOR_ORDER_STORAGE_KEY ? JSON.stringify({ ids: ['zed'] }) : null,
    );
    const { dispatched, task } = startSaga();
    await settle();

    expect(dispatched).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('persists the exact open action under the legacy-compatible key', async () => {
    const { send, task } = startSaga();
    await settle();
    storage.setItem.mockClear();
    send(setOpenAction('zed'));
    await settle();

    expect(storage.setItem.mock.calls).toEqual([['open-combo-button-last-action', 'zed']]);
    task.cancel();
    await task.toPromise();
  });

  it('persists post-reducer hidden editor IDs exactly', async () => {
    const { send, task } = startSaga();
    await settle();
    storage.setItem.mockClear();
    send(toggleHiddenEditor('vscode'));
    await settle();
    send(toggleHiddenEditor('zed'));
    await settle();
    send(toggleHiddenEditor('vscode'));
    await settle();

    expect(storage.setItem.mock.calls).toEqual([
      ['legacy-settings:hiddenOpenInEditors', JSON.stringify(['vscode'])],
      ['legacy-settings:hiddenOpenInEditors', JSON.stringify(['vscode', 'zed'])],
      ['legacy-settings:hiddenOpenInEditors', JSON.stringify(['zed'])],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('persists post-reducer editor order IDs', async () => {
    const { send, task } = startSaga();
    await settle();
    storage.setItem.mockClear();
    send(setEditorOrder(['zed', 'vscode']));
    await settle();

    expect(storage.setItem.mock.calls).toEqual([
      [EDITOR_ORDER_STORAGE_KEY, JSON.stringify(['zed', 'vscode'])],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('persists reconciled editor order after detection changes', async () => {
    const { send, task } = startSaga();
    await settle();
    storage.setItem.mockClear();
    send(setEditorOrder(['zed', 'removed']));
    await settle();
    storage.setItem.mockClear();
    send(
      fetchEditorsSuccess(
        [
          {
            id: 'vscode',
            name: 'VS Code',
            shortLabel: 'VS Code',
            appName: 'VS Code',
            category: 'ide',
            handlerType: 'vscode',
            priority: 1,
            installed: true,
          },
          {
            id: 'zed',
            name: 'Zed',
            shortLabel: 'Zed',
            appName: 'Zed',
            category: 'ide',
            handlerType: 'generic',
            priority: 0,
            installed: true,
          },
        ],
        123,
      ),
    );
    await settle();

    expect(storage.setItem.mock.calls).toEqual([
      [EDITOR_ORDER_STORAGE_KEY, JSON.stringify(['zed', 'vscode'])],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores unrelated and malformed open-action payloads', async () => {
    const { send, task } = startSaga();
    await settle();
    storage.setItem.mockClear();
    send({ type: 'unrelated/action' });
    send({ type: setOpenAction.type, payload: [42] });
    await settle();

    expect(storage.setItem.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('swallows read and write failures and continues handling later actions', async () => {
    storage.getItem.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    const { send, task } = startSaga();
    await settle();
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    send(setOpenAction('vscode'));
    await settle();
    storage.setItem.mockImplementation(() => undefined);
    send(setOpenAction('zed'));
    await settle();

    expect(storage.setItem.mock.calls).toEqual([
      ['open-combo-button-last-action', 'vscode'],
      ['open-combo-button-last-action', 'zed'],
    ]);
    expect(task.isRunning()).toBe(true);
    task.cancel();
    await task.toPromise();
  });

  it('cancels pending hydration without a late dispatch or installed watchers', async () => {
    let resolveRead!: (value: string | null) => void;
    storage.getItem.mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        resolveRead = resolve;
      }),
    );
    const { dispatched, send, task } = startSaga();
    task.cancel();
    await task.toPromise();
    resolveRead(JSON.stringify(['zed']));
    await settle();
    send(setOpenAction('zed'));
    await settle();

    expect(dispatched).toEqual([]);
    expect(storage.setItem.mock.calls).toEqual([]);
  });

  it('stops all persistence watchers after cancellation', async () => {
    const { send, task } = startSaga();
    await settle();
    task.cancel();
    await task.toPromise();
    storage.setItem.mockClear();
    send(setOpenAction('zed'));
    send(toggleHiddenEditor('vscode'));
    await settle();

    expect(storage.setItem.mock.calls).toEqual([]);
  });
});
