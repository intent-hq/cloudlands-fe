import { describe, expect, it } from 'vitest';
import {
  noteDeleteKeyEquals,
  parseNoteDeleteEvent,
  parseNoteDeleteOperationResponse,
  parseNoteDeleteScheduleRequest,
  parseNoteDeleteStatusResponse,
} from './note-delete';

const epoch = 'c0e57cf0-775e-4a25-9e2d-3a8fb076b332';
const key = { epoch, issuedTickMs: 100, nonce: '925dc7bb-a97b-43dc-9c72-237e23ccf859' };
const scope = { workspaceId: 'ws', noteId: 'spec' };
const current = { noteInstanceId: 'instance-new', revision: 7, sourceRevision: 'opaque:世代' };
const receipt = {
  operationKey: key,
  ...scope,
  noteInstanceId: 'instance-old',
  state: 'DELETED',
  sequence: 4,
  deadlineTickMs: 200,
  deleteAt: '2026-10-08T15:00:00Z',
  expiresTickMs: 300200,
  reason: null,
};
const pending = {
  operationKey: { ...key, nonce: '1b100c41-52cb-44a5-bd63-0be1815c600e' },
  noteId: 'spec',
  noteInstanceId: current.noteInstanceId,
  state: 'PENDING',
  sequence: 5,
  deadlineTickMs: 15000,
  deleteAt: '2026-10-08T15:00:00Z',
  canCancel: false,
};
const envelope = { epoch, serverTickMs: 210, sequence: 5 };
const request = { ...scope, operationKey: key };
const status = { ...envelope, current, pending: [pending], operation: receipt };
const schedule = {
  ...request,
  noteInstanceId: current.noteInstanceId,
  sourceRevision: current.sourceRevision,
  expectedVersion: current.revision,
};

describe('bounded note deletion contract', () => {
  it('keeps a historical receipt separate from the current incarnation and opaque revision', () => {
    expect(parseNoteDeleteStatusResponse(status, request)).toEqual(status);
    expect(
      parseNoteDeleteStatusResponse({ ...status, current: null, pending: [] }, request),
    ).toMatchObject({ current: null, operation: { noteInstanceId: 'instance-old' } });
  });

  it('accepts multiple incarnations of a textual ID only in workspace snapshots', () => {
    const snapshot = {
      ...envelope,
      current: null,
      operation: null,
      pending: [pending, { ...pending, noteInstanceId: 'instance-old', operationKey: key }],
    };
    expect(parseNoteDeleteStatusResponse(snapshot, { workspaceId: 'ws' })).toEqual(snapshot);
    expect(() => parseNoteDeleteStatusResponse(snapshot, scope)).toThrow();
  });

  it('retains committing and terminal callback-tail receipts without invented expiry', () => {
    for (const state of ['COMMITTING', 'DELETED']) {
      const value = { ...envelope, operation: { ...receipt, state, expiresTickMs: null } };
      expect(parseNoteDeleteOperationResponse(value, request)).toEqual(value);
    }
  });

  it('distinguishes settled uncertainty from an unknown lookup after restart', () => {
    const uncertain = {
      ...envelope,
      operation: { ...receipt, state: 'OUTCOME_UNKNOWN', reason: 'commitOutcomeUnknown' },
    };
    expect(parseNoteDeleteOperationResponse(uncertain, request)).toEqual(uncertain);
    const unknown = {
      ...envelope,
      epoch: '61f7a04c-d8d2-458d-8182-5d399c55d967',
      operation: { operationKey: key, state: 'UNKNOWN', reason: 'previousEpoch' },
    };
    expect(parseNoteDeleteOperationResponse(unknown, request)).toEqual(unknown);
    expect(() => parseNoteDeleteOperationResponse(unknown, request, true)).toThrow();
  });

  it.each([
    { ...status, pending: [{ ...pending, noteInstanceId: 'instance-old' }] },
    { ...status, current: null },
    { ...status, pending: [{ ...pending, state: 'COMMITTING', canCancel: true }] },
    { ...status, pending: [{ ...pending, state: 'OUTCOME_UNKNOWN', canCancel: true }] },
    { ...status, pending: [{ ...pending, sequence: 6 }] },
    { ...status, operation: { ...receipt, workspaceId: 'foreign' } },
    { ...status, operation: { ...receipt, noteId: 'foreign' } },
    { ...status, operation: { ...receipt, operationKey: pending.operationKey } },
    { ...status, current: { ...current, revision: Number.MAX_SAFE_INTEGER + 1 } },
    { ...status, current: { ...current, sourceRevision: '界'.repeat(43) } },
    { ...status, current: { ...current, content: 'body must not cross this seam' } },
    { ...status, serverTickMs: -1 },
    { ...status, sequence: 0.5 },
    { ...status, epoch: 'not-a-uuid' },
    { ...status, operation: { ...receipt, state: 'PENDING', expiresTickMs: 500 } },
    { ...status, operation: { ...receipt, state: 'OUTCOME_UNKNOWN', expiresTickMs: null } },
    { ...status, operation: { ...receipt, deleteAt: 'yesterday' } },
    { ...status, operation: { ...receipt, reason: 'madeUp' } },
    { ...status, content: 'x'.repeat(524288) },
  ])('rejects malformed, unbounded or mismatched responses', (value) => {
    expect(() => parseNoteDeleteStatusResponse(value, request)).toThrow();
  });

  it('enforces keyed versus unkeyed operation projections and workspace capacity', () => {
    expect(() => parseNoteDeleteStatusResponse({ ...status, operation: null }, request)).toThrow();
    expect(() => parseNoteDeleteStatusResponse(status, scope)).toThrow();
    expect(() =>
      parseNoteDeleteStatusResponse(
        {
          ...status,
          current: null,
          operation: null,
          pending: Array.from({ length: 257 }, () => pending),
        },
        { workspaceId: 'ws' },
      ),
    ).toThrow();
  });

  it('validates outgoing guards and never interprets a source revision', () => {
    expect(parseNoteDeleteScheduleRequest(schedule)).toEqual(schedule);
    for (const patch of [
      { undoDelayMs: 0 },
      { undoDelayMs: 60001 },
      { undoDelayMs: 1.5 },
      { expectedVersion: -1 },
      { sourceRevision: '' },
      { noteInstanceId: '' },
      { operationKey: { ...key, issuedTickMs: Number.MAX_SAFE_INTEGER + 1 } },
      { content: 'secret' },
    ]) {
      expect(() => parseNoteDeleteScheduleRequest({ ...schedule, ...patch })).toThrow();
    }
    expect(parseNoteDeleteScheduleRequest({ ...schedule, undoDelayMs: 60000 }).undoDelayMs).toBe(
      60000,
    );
  });

  it('checks the whole operation key and scoped invalidation event', () => {
    expect(noteDeleteKeyEquals(key, { ...key })).toBe(true);
    expect(noteDeleteKeyEquals(key, { ...key, issuedTickMs: 101 })).toBe(false);
    const event = {
      ...scope,
      epoch,
      operationKey: key,
      noteInstanceId: 'instance-old',
      sequence: 4,
      state: 'DELETED',
      deadlineTickMs: 200,
    };
    expect(parseNoteDeleteEvent(event, 'ws')).toEqual(event);
    expect(() => parseNoteDeleteEvent(event, 'foreign')).toThrow();
    expect(() => parseNoteDeleteEvent({ ...event, canCancel: true }, 'ws')).toThrow();
  });
});

it('accepts the 256-marker bound and rejects duplicate incarnation or operation entries', () => {
  const markers = Array.from({ length: 256 }, (_, i) => ({
    ...pending,
    noteInstanceId: `instance-${i}`,
    operationKey: { ...key, nonce: `925dc7bb-a97b-43dc-9c72-${String(i).padStart(12, '0')}` },
  }));
  const value = { ...envelope, current: null, operation: null, pending: markers };
  expect(parseNoteDeleteStatusResponse(value, { workspaceId: 'ws' }).pending).toHaveLength(256);
  expect(() =>
    parseNoteDeleteStatusResponse(
      { ...value, pending: [markers[0], markers[0]] },
      { workspaceId: 'ws' },
    ),
  ).toThrow();
  expect(() =>
    parseNoteDeleteStatusResponse(
      {
        ...value,
        pending: [markers[0], { ...markers[1], noteInstanceId: markers[0].noteInstanceId }],
      },
      { workspaceId: 'ws' },
    ),
  ).toThrow();
});
it('measures scalar bounds in UTF-8 bytes and never converts opaque source revisions', () => {
  const value = { ...schedule, sourceRevision: '😀'.repeat(32) };
  expect(parseNoteDeleteScheduleRequest(value).sourceRevision).toBe(value.sourceRevision);
  expect(() =>
    parseNoteDeleteScheduleRequest({ ...value, sourceRevision: `${value.sourceRevision}x` }),
  ).toThrow();
});
it('accepts retained uncertainty as a noncancellable current-incarnation marker', () => {
  const value = {
    ...status,
    pending: [{ ...pending, state: 'OUTCOME_UNKNOWN', canCancel: false }],
  };
  expect(parseNoteDeleteStatusResponse(value, request)).toEqual(value);
});

it('rejects contradictory receipt and public marker for the same operation key', () => {
  const matching = { ...pending, operationKey: key };
  const op = {
    ...receipt,
    noteInstanceId: current.noteInstanceId,
    state: matching.state,
    sequence: matching.sequence,
    deadlineTickMs: matching.deadlineTickMs,
    expiresTickMs: null,
  };
  const value = { ...status, pending: [matching], operation: op };
  expect(parseNoteDeleteStatusResponse(value, request)).toEqual(value);
  expect(() =>
    parseNoteDeleteStatusResponse(
      { ...value, operation: { ...op, noteInstanceId: 'historical-incarnation' } },
      request,
    ),
  ).toThrow();
  expect(() =>
    parseNoteDeleteStatusResponse({ ...value, operation: { ...op, state: 'COMMITTING' } }, request),
  ).toThrow();
});
