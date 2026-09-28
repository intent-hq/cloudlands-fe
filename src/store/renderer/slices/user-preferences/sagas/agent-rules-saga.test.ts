import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));
vi.mock('$lib/client', async () => {
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return { appClient: { settings: new LiveSettingsClient() } };
});

import {
  agentRulesContentChanged,
  agentRulesEditorClosed,
  agentRulesEditorOpened,
  saveAgentRules,
  undoAgentRulesChanges,
  userPreferencesReducer,
} from '../user-preferences-slice';
import { agentRulesSaga } from './agent-rules-saga';

const rule = { enabled: true, content: 'Original instructions', updatedAt: 1750000000000 };
const tasks: Task[] = [];
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

function start() {
  let userPreferences = userPreferencesReducer(undefined, { type: '@@init' } as never);
  const channel = stdChannel();
  const send = (action: { type: string }) => {
    userPreferences = userPreferencesReducer(userPreferences, action as never);
    channel.put(action);
  };
  const task = runSaga(
    { channel, dispatch: send, getState: () => ({ userPreferences }) },
    agentRulesSaga,
  );
  tasks.push(task);
  return { send, task, editor: () => userPreferences.agentRulesEditor };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.request
    .mockReset()
    .mockImplementation(async (method: string) =>
      method === 'rules.get' ? rule : { rules: { rules: [] } },
    );
});
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  vi.useRealTimers();
});

describe('agent rules persistence through the live wire adapter', () => {
  it('loads the protocol response, debounces edits and saves trimmed text without rewriting the draft', async () => {
    const { send, editor } = start();
    send(agentRulesEditorOpened());
    await settle();
    expect(mocks.request.mock.calls).toEqual([
      ['rules.get', { workspaceId: 'global', ruleType: 'base-system-prompt' }],
    ]);
    expect(editor()).toMatchObject({
      content: rule.content,
      originalContent: rule.content,
      loading: false,
    });
    send(agentRulesContentChanged(' first '));
    await vi.advanceTimersByTimeAsync(500);
    send(agentRulesContentChanged('\nlatest\n'));
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.request).toHaveBeenLastCalledWith('rules.update', {
      workspaceId: 'global',
      ruleType: 'base-system-prompt',
      content: 'latest',
    });
    expect(editor()).toMatchObject({
      content: '\nlatest\n',
      persistedContent: 'latest',
      saveStatus: 'saved',
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(editor().saveStatus).toBe('idle');
  });

  it('serializes writes and coalesces edits, including an Undo during an in-flight save', async () => {
    const write = deferred<unknown>();
    const { send, editor } = start();
    send(agentRulesEditorOpened());
    await settle();
    mocks.request.mockImplementationOnce(() => write.promise);
    send(agentRulesContentChanged('draft'));
    send(saveAgentRules());
    send(agentRulesContentChanged('later draft'));
    send(undoAgentRulesChanges());
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    write.resolve({ rules: { rules: [] } });
    await settle();
    expect(mocks.request.mock.calls.filter(([method]) => method === 'rules.update')).toEqual([
      ['rules.update', { workspaceId: 'global', ruleType: 'base-system-prompt', content: 'draft' }],
      [
        'rules.update',
        { workspaceId: 'global', ruleType: 'base-system-prompt', content: rule.content },
      ],
    ]);
    expect(editor()).toMatchObject({
      content: rule.content,
      persistedContent: rule.content,
      saveStatus: 'saved',
    });
  });

  it('keeps failed drafts retryable, reports errors and expires notifications in the saga', async () => {
    const { send, editor } = start();
    send(agentRulesEditorOpened());
    await settle();
    mocks.request.mockRejectedValueOnce(new Error('write refused'));
    send(agentRulesContentChanged('draft'));
    send(saveAgentRules());
    await settle();
    expect(editor()).toMatchObject({
      content: 'draft',
      persistedContent: rule.content,
      saveStatus: 'idle',
    });
    expect(editor().errorMessage).toContain('write refused');
    await vi.advanceTimersByTimeAsync(5000);
    expect(editor().errorMessage).toBeNull();
    send(saveAgentRules());
    await settle();
    expect(editor()).toMatchObject({ persistedContent: 'draft', saveStatus: 'saved' });
  });

  it('rejects stale failed writes without obscuring newer edits', async () => {
    const write = deferred<unknown>();
    const { send, editor } = start();
    send(agentRulesEditorOpened());
    await settle();
    mocks.request.mockImplementationOnce(() => write.promise);
    send(agentRulesContentChanged('old draft'));
    send(saveAgentRules());
    send(agentRulesContentChanged('new draft'));
    write.reject(new Error('old failure'));
    await settle();
    expect(editor()).toMatchObject({
      errorMessage: null,
      persistedContent: 'new draft',
      saveStatus: 'saved',
    });
  });

  it('does not write a trim-only change and blocks over-limit drafts', async () => {
    const { send, editor } = start();
    send(agentRulesEditorOpened());
    await settle();
    send(agentRulesContentChanged(`\n${rule.content}\n`));
    send(saveAgentRules());
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(editor().content).toBe(`\n${rule.content}\n`);
    send(agentRulesContentChanged('x'.repeat(50001)));
    send(saveAgentRules());
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(editor().errorMessage).not.toBeNull();
    expect(editor().saveStatus).toBe('idle');
  });

  it('surfaces failed loads and permits retry on reopen', async () => {
    mocks.request.mockRejectedValueOnce(new Error('read refused'));
    const { send, editor } = start();
    send(agentRulesEditorOpened());
    await settle();
    expect(editor().loading).toBe(false);
    expect(editor().errorMessage).not.toBeNull();
    send(agentRulesEditorClosed());
    send(agentRulesEditorOpened());
    await settle();
    expect(editor()).toMatchObject({ content: rule.content, errorMessage: null, loading: false });
  });

  it('drops an old load after close/reopen', async () => {
    const read = deferred<unknown>();
    mocks.request.mockImplementationOnce(() => read.promise);
    const { send, editor } = start();
    send(agentRulesEditorOpened());
    send(agentRulesEditorClosed());
    send(agentRulesEditorOpened());
    await settle();
    read.resolve({ ...rule, content: 'stale load' });
    await settle();
    expect(editor().content).toBe(rule.content);
  });

  it('waits for an old write before a reopened editor reads and ignores the old completion', async () => {
    const write = deferred<unknown>();
    const { send, editor } = start();
    send(agentRulesEditorOpened());
    await settle();
    mocks.request.mockImplementationOnce(() => write.promise);
    send(agentRulesContentChanged('old draft'));
    send(saveAgentRules());
    send(agentRulesEditorClosed());
    send(agentRulesEditorOpened());
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(editor()).toMatchObject({ loading: true, saveStatus: 'idle' });
    write.resolve({ rules: { rules: [] } });
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(3);
    expect(editor()).toMatchObject({ content: rule.content, saveStatus: 'idle', loading: false });
  });

  it('cancels debounce on close and all work on root cancellation without late updates', async () => {
    const write = deferred<unknown>();
    const { send, task, editor } = start();
    send(agentRulesEditorOpened());
    await settle();
    send(agentRulesContentChanged('abandoned draft'));
    send(agentRulesEditorClosed());
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    send(agentRulesEditorOpened());
    await settle();
    mocks.request.mockImplementationOnce(() => write.promise);
    send(agentRulesContentChanged('in flight'));
    send(saveAgentRules());
    send(agentRulesContentChanged('queued'));
    task.cancel();
    await task.toPromise();
    const stopped = editor();
    write.resolve({ rules: { rules: [] } });
    await vi.advanceTimersByTimeAsync(10000);
    expect(editor()).toBe(stopped);
    expect(editor()).toMatchObject({ active: false, saveStatus: 'idle' });
    expect(mocks.request).toHaveBeenCalledTimes(3);
  });
});
