import { describe, expect, it } from 'vitest';
import {
  createNoteResourceLedger,
  retainNoteResourcesFrom,
  releaseNoteResources,
  requestNoteResources,
  transferNoteResources,
  settleNoteResource,
  type NoteResourceCost,
} from './note-resource-ledger';

const cost = (payloadBytes: number, physicalReads = 0): NoteResourceCost => ({
  payloadBytes,
  stringUnits: payloadBytes,
  objectNodes: 1,
  domNodes: 0,
  physicalReads,
  assemblies: 0,
});
const create = () =>
  createNoteResourceLedger({
    ...cost(100, 1),
    objectNodes: 20,
    domNodes: 20,
    assemblies: 1,
  });
const resource = (id: string, bytes: number, physicalReads = 0) => ({
  id,
  cost: cost(bytes, physicalReads),
});

describe('shared note resource reservations', () => {
  it('transfers unused decode allowance to queued work while keeping the retained allocation charged', () => {
    let ledger = requestNoteResources(create(), 'reader', [resource('decoded', 100)]).ledger;
    ledger = requestNoteResources(ledger, 'next-read', [resource('next', 60)]).ledger;
    ledger = settleNoteResource(ledger, 'decoded', cost(30));
    expect(ledger.used.payloadBytes).toBe(90);
    expect(ledger.owners.reader).toEqual(['decoded']);
    expect(ledger.owners['next-read']).toEqual(['next']);
    expect(() => settleNoteResource(ledger, 'decoded', cost(31))).toThrow(/allowance/);
  });
  it('reserves atomically before construction and rejects an impossible minimum without queueing', () => {
    const initial = create();
    const admitted = requestNoteResources(initial, 'note-a/candidate', [resource('a', 70)]);
    expect(admitted.status).toBe('admitted');
    const waiting = requestNoteResources(admitted.ledger, 'note-b/candidate', [resource('b', 40)]);
    expect(waiting.status).toBe('queued');
    expect(waiting.ledger.used.payloadBytes).toBe(70);
    expect(waiting.ledger.resources.b).toBeUndefined();
    const impossible = requestNoteResources(waiting.ledger, 'note-c/candidate', [
      resource('c', 101),
    ]);
    expect(impossible.status).toBe('impossible');
    expect(impossible.ledger).toBe(waiting.ledger);
  });

  it('keeps an evicted page charged through another panel assembly lease', () => {
    let ledger = requestNoteResources(create(), 'note-a/cache', [
      resource('actual-page', 60),
    ]).ledger;
    ledger = requestNoteResources(ledger, 'note-a/panel-b/assembly', [
      resource('actual-page', 60),
    ]).ledger;
    expect(ledger.used.payloadBytes).toBe(60);
    ledger = releaseNoteResources(ledger, 'note-a/cache');
    expect(ledger.used.payloadBytes).toBe(60);
    ledger = releaseNoteResources(ledger, 'note-a/panel-b/assembly');
    expect(ledger.used.payloadBytes).toBe(0);
  });

  it('charges distinct native copies and old/new view overlap independently', () => {
    let ledger = requestNoteResources(create(), 'panel/active', [
      resource('old-native', 55),
    ]).ledger;
    const candidate = requestNoteResources(ledger, 'panel/candidate', [resource('new-native', 50)]);
    expect(candidate.status).toBe('queued');
    ledger = releaseNoteResources(candidate.ledger, 'panel/active');
    expect(ledger.owners['panel/candidate']).toEqual(['new-native']);
    expect(ledger.used.payloadBytes).toBe(50);
  });

  it('transfers accepted ownership without a release gap and preserves an independent physical read', () => {
    let ledger = requestNoteResources(create(), 'physical/read', [resource('frame', 20, 1)]).ledger;
    ledger = requestNoteResources(ledger, 'assembly', [resource('window', 60)]).ledger;
    ledger = transferNoteResources(ledger, 'assembly', 'panel/window');
    ledger = releaseNoteResources(ledger, 'assembly');
    expect(ledger.used).toMatchObject({ payloadBytes: 80, physicalReads: 1 });
    ledger = releaseNoteResources(ledger, 'panel/window');
    expect(ledger.used).toMatchObject({ payloadBytes: 20, physicalReads: 1 });
    ledger = releaseNoteResources(ledger, 'physical/read');
    expect(ledger.used).toMatchObject({ payloadBytes: 0, physicalReads: 0 });
  });

  it('wakes queued work across notes in FIFO order and coalesces one pending owner', () => {
    let ledger = requestNoteResources(create(), 'note-a/read', [resource('a', 100)]).ledger;
    ledger = requestNoteResources(ledger, 'note-b/read', [resource('b-old', 70)]).ledger;
    ledger = requestNoteResources(ledger, 'note-c/read', [resource('c', 50)]).ledger;
    ledger = requestNoteResources(ledger, 'note-b/read', [resource('b-new', 60)]).ledger;
    expect(ledger.pending.map((request) => request.owner)).toEqual(['note-b/read', 'note-c/read']);
    ledger = releaseNoteResources(ledger, 'note-a/read');
    expect(ledger.owners['note-b/read']).toEqual(['b-new']);
    expect(ledger.owners['note-c/read']).toBeUndefined();
    ledger = releaseNoteResources(ledger, 'note-b/read');
    expect(ledger.owners['note-c/read']).toEqual(['c']);
  });

  it('cancels queued ownership and rejects forged sharing costs or an occupied transfer target', () => {
    let ledger = requestNoteResources(create(), 'active', [resource('a', 60)]).ledger;
    expect(() => requestNoteResources(ledger, 'forged', [resource('a', 1)])).toThrow(/cost/);
    ledger = requestNoteResources(ledger, 'pending', [resource('b', 50)]).ledger;
    ledger = releaseNoteResources(ledger, 'pending');
    expect(ledger.pending).toHaveLength(0);
    ledger = requestNoteResources(ledger, 'other', [resource('c', 10)]).ledger;
    expect(() => transferNoteResources(ledger, 'active', 'other')).toThrow(/target/);
    expect(ledger.used.payloadBytes).toBe(70);
  });

  it('keeps composition active plus only the latest pending replacement', () => {
    let ledger = requestNoteResources(create(), 'composing', [resource('active', 40)]).ledger;
    ledger = requestNoteResources(ledger, 'pending', [resource('old-pending', 30)]).ledger;
    // Actual caller disposes the previous pending object before releasing its lease.
    ledger = releaseNoteResources(ledger, 'pending');
    ledger = requestNoteResources(ledger, 'pending', [resource('new-pending', 50)]).ledger;
    expect(ledger.used.payloadBytes).toBe(90);
    expect(ledger.resources['old-pending']).toBeUndefined();
    ledger = releaseNoteResources(ledger, 'composing');
    ledger = transferNoteResources(ledger, 'pending', 'active');
    expect(ledger.used.payloadBytes).toBe(50);
  });

  it('drops superseded queued demand when the latest minimum cannot ever fit', () => {
    let ledger = requestNoteResources(create(), 'active', [resource('a', 100)]).ledger;
    ledger = requestNoteResources(ledger, 'next', [resource('old-demand', 60)]).ledger;
    const impossible = requestNoteResources(ledger, 'next', [resource('new-demand', 101)]);
    expect(impossible.status).toBe('impossible');
    ledger = releaseNoteResources(impossible.ledger, 'active');
    expect(ledger.owners.next).toBeUndefined();
    expect(ledger.pending).toHaveLength(0);
    expect(ledger.used.payloadBytes).toBe(0);
  });

  it('rejects unsafe numbers, duplicate identities and bounds control metadata', () => {
    expect(() => requestNoteResources(create(), 'x', [resource('x', NaN)])).toThrow();
    expect(() => requestNoteResources(create(), 'x', [resource('x', -1)])).toThrow();
    expect(() =>
      requestNoteResources(create(), 'x', [resource('x', 1), resource('x', 1)]),
    ).toThrow();
    let ledger = createNoteResourceLedger(cost(1), { owners: 2, resources: 2, pending: 1 });
    ledger = requestNoteResources(ledger, 'a', [resource('a', 1)]).ledger;
    ledger = requestNoteResources(ledger, 'b', [resource('b', 1)]).ledger;
    expect(requestNoteResources(ledger, 'c', [resource('c', 1)]).status).toBe('capacity');
    expect(ledger.pending).toHaveLength(1);
  });
});

it('reserves metadata for completion and attaches children without new global admission', () => {
  const initial = createNoteResourceLedger(
    { ...cost(100, 1), objectNodes: 20, assemblies: 1 },
    { owners: 4, resources: 8, pending: 4 },
  );
  let ledger = requestNoteResources(initial, 'assembly', [resource('data', 90)], 4).ledger;
  ledger = requestNoteResources(ledger, 'unrelated', [resource('other', 1)]).ledger;
  expect(ledger.owners.unrelated).toBeUndefined();
  ledger = retainNoteResourcesFrom(ledger, 'assembly', 'cache', ['data']);
  ledger = retainNoteResourcesFrom(ledger, 'assembly', 'window', ['data'], 2);
  expect(ledger.ownerSlots).toEqual({ assembly: 1, cache: 1, window: 2 });
  ledger = retainNoteResourcesFrom(ledger, 'window', 'view', ['data']);
  expect(ledger.used.payloadBytes).toBe(90);
  ledger = releaseNoteResources(ledger, 'cache');
  expect(ledger.ownerSlots.assembly).toBe(2);
  expect(ledger.owners.unrelated).toBeUndefined();
  ledger = releaseNoteResources(ledger, 'assembly');
  expect(ledger.owners.unrelated).toEqual(['other']);
  expect(ledger.resources.data.owners).toEqual(['window', 'view']);
  ledger = releaseNoteResources(ledger, 'window');
  expect(ledger.resources.data.owners).toEqual(['view']);
  ledger = releaseNoteResources(ledger, 'view');
  expect(ledger.used.payloadBytes).toBe(1);
});

it('rejects unreserved child ownership and preserves sponsor relations through transfer', () => {
  let ledger = requestNoteResources(create(), 'assembly', [resource('data', 90)], 2).ledger;
  expect(() => retainNoteResourcesFrom(ledger, 'assembly', 'bad', ['unowned'])).toThrow();
  ledger = retainNoteResourcesFrom(ledger, 'assembly', 'cache', ['data']);
  expect(() => retainNoteResourcesFrom(ledger, 'assembly', 'extra', ['data'])).toThrow();
  ledger = transferNoteResources(ledger, 'assembly', 'accepted');
  ledger = releaseNoteResources(ledger, 'cache');
  expect(ledger.ownerSlots.accepted).toBe(2);
  expect(ledger.ownerSlots.assembly).toBeUndefined();
  expect(ledger.used.payloadBytes).toBe(90);
});
