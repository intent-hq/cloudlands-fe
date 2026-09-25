import { describe, expect, it } from 'vitest';
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  settingsEventsReducer as reduce,
  settingsFormOpened,
  settingsFormClosed,
  settingsFormLoadRequested,
  settingsFormSaveRequested,
  settingsFormRequestStarted,
  settingsFormRequestSettled,
  settingsFormDraftChanged,
  settingsFormEntriesReceived,
  settingsFormRequestProgressed,
  settingsFormSaveQueueFailed,
} from './settings-events-slice';

const identity = { formId: 'form', sessionId: 'mount-1' };
const read = { ...identity, resource: 'load', requestId: 'read-1' };
const save = { ...identity, resource: 'agents.maxConcurrent', requestId: 'write-1' };
const entry = { path: 'agents.maxConcurrent', value: 12 };
const form = (state: ReturnType<typeof reduce>) => getItem(state.forms, identity.formId)!;

describe('settingsEventsReducer', () => {
  it.each(['copy', 'qr'])('does not let API %s invalidate an in-flight snapshot', (resource) => {
    let state = reduce(undefined, settingsFormOpened(identity, 'websocket-api'));
    state = reduce(state, settingsFormRequestStarted(read));
    const effect = { ...identity, resource, requestId: 'effect' };
    state = reduce(state, settingsFormRequestStarted(effect));
    state = reduce(state, settingsFormRequestSettled(effect, { status: 'succeeded' }));
    state = reduce(state, settingsFormRequestProgressed(read, { port: 5181 }));
    expect(form(state).values.port).toBe(5181);
    state = reduce(
      state,
      settingsFormRequestSettled(read, {
        status: 'succeeded',
        values: { localIps: ['192.0.2.10'] },
      }),
    );
    expect(form(state).values).toEqual({ port: 5181, localIps: ['192.0.2.10'] });
    expect(form(state).loaded).toBe(true);
  });

  it('invalidates only a matching backend resource queue and its drafts', () => {
    let state = reduce(undefined, settingsFormOpened(identity, 'agent-backend'));
    state = reduce(state, settingsFormDraftChanged(identity, entry.path, '18'));
    state = reduce(state, settingsFormSaveRequested(save, [{ ...entry, value: 18 }]));
    expect(
      reduce(
        state,
        settingsFormSaveRequested({ ...save, requestId: 'duplicate' }, [{ ...entry, value: 18 }]),
      ),
    ).toBe(state);
    state = reduce(state, settingsFormDraftChanged(identity, entry.path, '24'));
    state = reduce(state, settingsFormDraftChanged(identity, `${entry.path}:slider`, 24));
    state = reduce(state, settingsFormDraftChanged(identity, 'other', 'retain'));
    state = reduce(
      state,
      settingsFormSaveRequested({ ...save, requestId: 'queued' }, [{ ...entry, value: 24 }]),
    );
    expect(
      reduce(
        state,
        settingsFormSaveQueueFailed({ ...save, sessionId: 'old' }, [entry.path], 'failed'),
      ),
    ).toBe(state);
    state = reduce(state, settingsFormSaveQueueFailed(save, [entry.path], 'failed'));
    expect(form(state).drafts).toEqual({ other: 'retain' });
    expect(getItem(form(state).operations, save.resource)).toMatchObject({
      requestId: 'queued',
      status: 'failed',
      error: 'failed',
    });
    expect(reduce(state, settingsFormSaveQueueFailed(save, [entry.path], 'later'))).toBe(state);
  });
  it('accepts correlated progress without settling and rejects stale or completed progress', () => {
    let state = reduce(undefined, settingsFormOpened(identity, 'websocket-api'));
    state = reduce(state, settingsFormRequestStarted(read));
    state = reduce(state, settingsFormRequestProgressed(read, { enabled: true }));
    expect(form(state).values).toEqual({ enabled: true });
    expect(getItem(form(state).operations, 'load')?.status).toBe('pending');
    const baseline = state;
    for (const invalid of [
      { ...read, sessionId: 'old' },
      { ...read, requestId: 'old' },
      { ...read, resource: 'other' },
    ]) {
      expect(reduce(state, settingsFormRequestProgressed(invalid, { enabled: false }))).toBe(
        baseline,
      );
    }
    state = reduce(state, settingsFormRequestStarted(save));
    expect(reduce(state, settingsFormRequestProgressed(read, { enabled: false }))).toBe(state);
    state = reduce(state, settingsFormRequestSettled(save, { status: 'succeeded' }));
    expect(reduce(state, settingsFormRequestProgressed(save, { enabled: false }))).toBe(state);
  });
  it('opens empty serializable forms and removes only the matching session', () => {
    const initial = reduce(undefined, { type: '@@init' });
    expect(getItems(initial.forms)).toEqual([]);
    const opened = reduce(initial, settingsFormOpened(identity, 'agent-backend'));
    expect(form(opened).loaded).toBe(false);
    expect(JSON.parse(JSON.stringify(opened))).toEqual(opened);
    expect(reduce(opened, settingsFormClosed({ ...identity, sessionId: 'old' }))).toBe(opened);
    expect(getItems(reduce(opened, settingsFormClosed(identity)).forms)).toEqual([]);
  });

  it('settles only the latest pending request and ignores late completion after reopen', () => {
    let state = reduce(undefined, settingsFormOpened(identity, 'agent-backend'));
    state = reduce(state, settingsFormLoadRequested(read));
    const newer = { ...read, requestId: 'read-2' };
    state = reduce(state, settingsFormLoadRequested(newer));
    expect(
      reduce(state, settingsFormRequestSettled(read, { status: 'failed', error: 'old' })),
    ).toBe(state);
    state = reduce(
      state,
      settingsFormRequestSettled(newer, { status: 'succeeded', entries: [entry] }),
    );
    expect(form(state).loaded).toBe(true);
    expect(getItem(form(state).entries, entry.path)?.value).toBe(12);
    expect(reduce(state, settingsFormRequestSettled(newer, { status: 'failed' }))).toBe(state);
    state = reduce(
      state,
      settingsFormOpened({ ...identity, sessionId: 'mount-2' }, 'agent-backend'),
    );
    expect(
      reduce(state, settingsFormRequestSettled(newer, { status: 'succeeded', entries: [entry] })),
    ).toBe(state);
    expect(reduce(state, settingsFormEntriesReceived(identity, [entry]))).toBe(state);
    expect(reduce(state, settingsFormDraftChanged(identity, entry.path, '20'))).toBe(state);
    expect(reduce(state, settingsFormRequestStarted(save))).toBe(state);
  });

  it('does not overwrite a newer committed value with a racing read', () => {
    let state = reduce(undefined, settingsFormOpened(identity, 'agent-backend'));
    state = reduce(state, settingsFormLoadRequested(read));
    state = reduce(state, settingsFormSaveRequested(save, [entry]));
    state = reduce(state, settingsFormEntriesReceived(identity, [entry]));
    state = reduce(state, settingsFormRequestSettled(save, { status: 'succeeded' }));
    state = reduce(
      state,
      settingsFormRequestSettled(read, {
        status: 'succeeded',
        entries: [{ ...entry, value: 0 }],
        values: { stale: true },
      }),
    );
    expect(getItem(form(state).entries, entry.path)?.value).toBe(12);
    expect(form(state).values).toEqual({});
  });

  it('preserves edits made during reads or writes, clearing only the submitted draft', () => {
    let state = reduce(undefined, settingsFormOpened(identity, 'workspace-api'));
    state = reduce(state, settingsFormLoadRequested(read));
    state = reduce(state, settingsFormDraftChanged(identity, entry.path, '18'));
    state = reduce(
      state,
      settingsFormRequestSettled(read, { status: 'succeeded', entries: [entry] }),
    );
    expect(form(state).drafts[entry.path]).toBe('18');
    state = reduce(state, settingsFormSaveRequested(save, [{ ...entry, value: 18 }]));
    state = reduce(state, settingsFormDraftChanged(identity, entry.path, '24'));
    state = reduce(state, settingsFormRequestSettled(save, { status: 'failed', error: 'failed' }));
    expect(form(state).drafts[entry.path]).toBe('24');
    const retry = { ...save, requestId: 'retry' };
    state = reduce(state, settingsFormSaveRequested(retry, [{ ...entry, value: 24 }]));
    state = reduce(
      state,
      settingsFormRequestSettled(retry, {
        status: 'succeeded',
        entries: [{ ...entry, value: 24 }],
      }),
    );
    expect(form(state).drafts).toEqual({});
    expect(getItem(form(state).operations, save.resource)?.error).toBeNull();
  });

  it('keeps failed git drafts for retry and settles cancellation visibly', () => {
    let state = reduce(undefined, settingsFormOpened(identity, 'git-workspace'));
    state = reduce(state, settingsFormDraftChanged(identity, entry.path, '18'));
    state = reduce(state, settingsFormSaveRequested(save, [entry]));
    state = reduce(state, settingsFormRequestSettled(save, { status: 'failed', error: 'failed' }));
    expect(form(state).drafts[entry.path]).toBe('18');
    const retry = { ...save, requestId: 'retry' };
    state = reduce(state, settingsFormRequestStarted(retry));
    state = reduce(state, settingsFormRequestSettled(retry, { status: 'cancelled' }));
    expect(getItem(form(state).operations, save.resource)?.status).toBe('cancelled');
  });
});
