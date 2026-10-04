import { expect, it, vi } from 'vitest';
import * as actions from '$store/renderer/slices/note-pages/note-pages-slice';
import { createNoteResourceOwner } from './note-resource-owner';
import type { NoteResourceCost } from './note-resource-ledger';

const cost: NoteResourceCost = {
  payloadBytes: 100,
  stringUnits: 100,
  objectNodes: 10,
  domNodes: 10,
  physicalReads: 0,
  assemblies: 0,
};
function fixture() {
  let state = actions.notePagesReducer(
    actions.initialNotePagesState,
    actions.pageResourceLimitsConfigured(cost),
  );
  const runtime = createNoteResourceOwner({
    read: () => state.resourceLedger,
    dispatch: (action) => {
      state = actions.notePagesReducer(state, action);
    },
  });
  return { runtime, state: () => state };
}

it('checks admission before invoking a constructor and releases a failed constructor', () => {
  const { runtime, state } = fixture();
  const first = runtime.reservation('first', cost);
  const second = runtime.reservation('second', cost);
  const create = vi.fn(() => ({}));
  expect(first.construct(create, () => {})).toBeDefined();
  expect(second.construct(create, () => {})).toBeUndefined();
  expect(create).toHaveBeenCalledTimes(1);
  first.release();
  expect(() =>
    second.construct(
      () => {
        throw new Error('decoder failed');
      },
      () => {},
    ),
  ).toThrow('decoder failed');
  expect(state().resourceLedger.used.payloadBytes).toBe(0);
});

it('shares the same actual object across owners while charging a copy independently', () => {
  const { runtime, state } = fixture();
  const ticket = runtime.reservation('producer', cost);
  const actual = ticket.construct(
    () => ({ text: 'same value' }),
    () => {},
  )!;
  expect(runtime.retain('consumer', actual, cost)).toBe(true);
  const copy = runtime.reservation('different-object', cost);
  expect(
    copy.construct(
      () => ({ text: actual.text }),
      () => {},
    ),
  ).toBeUndefined();
  ticket.release();
  expect(state().resourceLedger.used.payloadBytes).toBe(100);
  runtime.release('consumer');
  expect(state().resourceLedger.owners['different-object']).toHaveLength(1);
  runtime.release('different-object');
  expect(state().resourceLedger.used.payloadBytes).toBe(0);
});

it('holds physical credit until asynchronous disposal finishes, even when a panel closes', async () => {
  const { runtime, state } = fixture();
  const ticket = runtime.reservation('dom', cost);
  ticket.construct(
    () => ({}),
    () => {},
  );
  let resolve!: () => void;
  const disposal = new Promise<void>((r) => {
    resolve = r;
  });
  const done = ticket.disposeAfter(() => disposal);
  expect(state().resourceLedger.used.payloadBytes).toBe(100);
  resolve();
  await done;
  expect(state().resourceLedger.used.payloadBytes).toBe(0);
});

it('transfers ownership without granting reuse of the old construction ticket', () => {
  const { runtime, state } = fixture();
  const ticket = runtime.reservation('candidate', cost);
  ticket.construct(
    () => ({}),
    () => {},
  );
  ticket.transfer('active');
  ticket.release();
  expect(state().resourceLedger.used.payloadBytes).toBe(100);
  expect(() =>
    ticket.construct(
      () => ({}),
      () => {},
    ),
  ).toThrow(/closed/);
  runtime.release('active');
  expect(state().resourceLedger.used.payloadBytes).toBe(0);
});
