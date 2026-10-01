/** Test-only backing store. Its Maps model disk/server state, NOT renderer caches. */
import { bytes } from './bounded-note-service';
export const LIMITS = {
  request: 4096,
  active: 16384,
  cachePages: 4,
  nodes: 256,
  journalPage: 4096,
  journalResident: 16384,
  log: 32,
  receipts: 32,
};
export const fixture = (id: number) =>
  `Region ${String(id).padStart(4, '0')} — café 🌍. repeated repeated [link](https://example.test).\n\n`;
export type Selection = { anchor: number; head: number; affinity: -1 | 1; revision: number };
export type Splice = { from: number; to: number; insert: string };
export type Change = Splice & { removed: string };
export type Anchor = { id: string; from: number; to: number; alive: boolean };
export type Event = {
  changes: Change[];
  before: Selection;
  after: Selection;
  anchorsBefore: Anchor[];
  anchorsAfter: Anchor[];
};
export const mapPoint = (p: number, s: Splice, affinity = 1) =>
  p < s.from || (p === s.from && affinity < 0)
    ? p
    : p > s.to || (p === s.to && affinity > 0)
      ? p + s.insert.length - (s.to - s.from)
      : s.from + (affinity < 0 ? 0 : s.insert.length);
export const mapSelection = (r: Selection, s: Splice, revision: number): Selection => ({
  ...r,
  anchor: mapPoint(r.anchor, s, r.affinity),
  head: mapPoint(r.head, s, r.affinity),
  revision,
});

export class SourceJournal {
  readonly count: number;
  revision = 1;
  generation = 1;
  commentRevision = 1;
  private regions = new Map<number, string>();
  private persisted = new Map<number, string>();
  private receipts = new Map<string, { payload: string; revision: number }>();
  private events: Array<{ meta: Omit<Event, 'changes'>; pages: string[] }> = [];
  private baseLengths: number[];
  cursor = 0;
  readonly logs: { method: string; from: number; bytes: number }[] = [];
  reads = 0;
  maxRead = 0;
  journalReads = 0;
  maxJournalRead = 0;
  writes = 0;
  draftWrites = 0;
  maxSpliceBytes = 0;
  loseAcknowledgement = false;
  anchors: Anchor[];
  constructor(
    readonly generate = fixture,
    count = 10000,
  ) {
    this.count = count;
    this.baseLengths =
      count <= 20
        ? Array.from({ length: count }, (_, id) => generate(id).length)
        : [generate(0).length];
    const seam = generate(0).length;
    this.anchors = [
      {
        id: 'seam',
        from: Math.max(0, generate(0).indexOf('repeated')),
        to: seam + 11,
        alive: true,
      },
    ];
  }
  region(id: number) {
    return this.regions.get(id) ?? this.generate(id);
  }
  start(id: number) {
    let result =
      this.baseLengths.length === 1
        ? id * this.baseLengths[0]
        : this.baseLengths.slice(0, id).reduce((a, b) => a + b, 0);
    for (const [index, value] of this.regions)
      if (index < id) result += value.length - this.baseLength(index);
    return result;
  }
  private baseLength(id: number) {
    return this.baseLengths.length === 1 ? this.baseLengths[0] : this.baseLengths[id];
  }
  get length() {
    return this.start(this.count);
  }
  locate(position: number) {
    let lo = 0,
      hi = this.count - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.start(mid) <= position) lo = mid;
      else hi = mid - 1;
    }
    return { id: lo, start: this.start(lo) };
  }
  private log(method: string, from: number, size: number) {
    this.logs.push({ method, from, bytes: size });
    if (this.logs.length > LIMITS.log) this.logs.shift();
  }
  read(from: number, to: number, revision = this.revision) {
    if (revision !== this.revision) throw new Error('Stale source revision');
    const source = this.slice(from, to);
    if (bytes(source) > LIMITS.request) throw new Error('Read exceeds page budget');
    this.reads++;
    this.maxRead = Math.max(this.maxRead, bytes(source));
    this.log('read', from, bytes(source));
    return { from, source, revision };
  }
  slice(from: number, to: number) {
    const first = this.locate(from),
      last = this.locate(to);
    let value = '';
    for (let id = first.id; id <= last.id; id++) {
      const start = this.start(id);
      value += this.region(id).slice(Math.max(0, from - start), Math.max(0, to - start));
    }
    return value;
  }
  apply(splice: Splice): Change {
    if (splice.from < 0 || splice.to < splice.from || splice.to > this.length)
      throw new Error('Invalid source range');
    const removed = this.slice(splice.from, splice.to);
    this.draftWrites++;
    this.maxSpliceBytes = Math.max(this.maxSpliceBytes, bytes(JSON.stringify(splice)));
    this.log('splice', splice.from, bytes(JSON.stringify(splice)));
    const first = this.locate(splice.from),
      last = this.locate(splice.to);
    const suffix = this.region(last.id).slice(splice.to - last.start);
    if (first.id === last.id)
      this.regions.set(
        first.id,
        this.region(first.id).slice(0, splice.from - first.start) + splice.insert + suffix,
      );
    else {
      this.regions.set(
        first.id,
        this.region(first.id).slice(0, splice.from - first.start) + splice.insert,
      );
      for (let id = first.id + 1; id < last.id; id++) this.regions.set(id, '');
      this.regions.set(last.id, suffix);
    }
    this.anchors = this.anchors.map((a) => ({
      ...a,
      from: mapPoint(a.from, splice, 1),
      to: mapPoint(a.to, splice, -1),
      alive: a.alive && !(splice.from <= a.from && splice.to >= a.to && splice.to > splice.from),
    }));
    this.revision++;
    return { ...splice, removed };
  }
  commit(operationId: string, expectedRevision: number, splice: Splice) {
    const payload = JSON.stringify({ expectedRevision, splice });
    const receipt = this.receipts.get(operationId);
    if (receipt) {
      if (receipt.payload !== payload) throw new Error('Operation ID reused');
      return receipt.revision;
    }
    if (expectedRevision !== this.revision) throw new Error('Write conflict');
    if (bytes(payload) > LIMITS.request) throw new Error('Write exceeds budget');
    this.apply(splice);
    this.writes++;
    this.receipts.set(operationId, { payload, revision: this.revision });
    if (this.receipts.size > LIMITS.receipts)
      this.receipts.delete(this.receipts.keys().next().value!);
    if (this.loseAcknowledgement) {
      this.loseAcknowledgement = false;
      throw new Error('Acknowledgement lost');
    }
    return this.revision;
  }
  save() {
    this.persisted = new Map(this.regions);
  }
  get dirty() {
    return [...this.regions]
      .filter(([id, source]) => source !== (this.persisted.get(id) ?? this.generate(id)))
      .map(([id]) => id);
  }
  annotations(from: number, to: number, revision: number, generation: number) {
    if (revision !== this.revision || generation !== this.generation)
      throw new Error('Stale annotations');
    const items = this.anchors
      .filter((a) => a.alive && a.from < to && a.to > from)
      .slice(0, 8)
      .map((a) => ({ ...a }));
    const result = { revision, generation, commentRevision: this.commentRevision, items };
    this.log('annotations', from, bytes(JSON.stringify(result)));
    return result;
  }
  /** One change per disk page; grouping never rehydrates preceding changes. */
  event(index: number) {
    return structuredClone(this.events[index].meta);
  }
  bookmark(index: number, key: 'before' | 'after', selection: Selection) {
    this.events[index].meta[key] = { ...selection };
  }
  *changes(index: number, reverse = false): Generator<Change> {
    const pages = this.events[index].pages;
    for (let n = 0; n < pages.length; n++) {
      const page = pages[reverse ? pages.length - 1 - n : n];
      this.maxJournalRead = Math.max(this.maxJournalRead, bytes(page));
      this.journalReads++;
      yield JSON.parse(page);
    }
  }
  record(event: Event, group: boolean) {
    this.events.splice(this.cursor);
    const pages = event.changes.map((change) => JSON.stringify(change));
    if (pages.some((page) => bytes(page) > LIMITS.journalPage))
      throw new Error('Journal change exceeds page budget');
    const { changes: _changes, ...meta } = event;
    const previous = group && this.cursor ? this.events[this.cursor - 1] : undefined;
    if (previous) {
      previous.pages.push(...pages);
      previous.meta.after = meta.after;
      previous.meta.anchorsAfter = meta.anchorsAfter;
    } else {
      this.events.push({ meta, pages });
      this.cursor++;
    }
    if (this.events.length > 120) {
      this.events.splice(0, this.events.length - 100);
      this.cursor = this.events.length;
    }
  }
  rebase(splice: Splice) {
    const anchors = (entries: Anchor[]) =>
      entries.map((a) => ({
        ...a,
        from: mapPoint(a.from, splice),
        to: mapPoint(a.to, splice, -1),
      }));
    for (const event of this.events) {
      event.meta.before = mapSelection(event.meta.before, splice, this.revision);
      event.meta.after = mapSelection(event.meta.after, splice, this.revision);
      event.meta.anchorsBefore = anchors(event.meta.anchorsBefore);
      event.meta.anchorsAfter = anchors(event.meta.anchorsAfter);
      event.pages = event.pages.map((page) => {
        const change: Change = JSON.parse(page);
        return JSON.stringify({
          ...change,
          from: mapPoint(change.from, splice),
          to: mapPoint(change.to, splice),
        });
      });
    }
  }
  get depth() {
    return this.events.length;
  }
  get stats() {
    return {
      draftWrites: this.draftWrites,
      maxSpliceBytes: this.maxSpliceBytes,
      backingSourceBytes: [...this.regions.values()].reduce((n, s) => n + bytes(s), 0),
      backingSavedBytes: [...this.persisted.values()].reduce((n, s) => n + bytes(s), 0),
      backingJournalBytes: this.events.reduce(
        (n, e) => n + bytes(JSON.stringify(e.meta)) + e.pages.reduce((m, p) => m + bytes(p), 0),
        0,
      ),
      journalPages: this.events.reduce((n, e) => n + e.pages.length, 0),
      journalEvents: this.events.length,
      maxJournalRead: this.maxJournalRead,
      receiptCount: this.receipts.size,
      receiptBytes: [...this.receipts.values()].reduce((n, r) => n + bytes(r.payload), 0),
      logCount: this.logs.length,
      logBytes: bytes(JSON.stringify(this.logs)),
      dirty: this.dirty,
    };
  }
}
