import { expect, it } from 'vitest';
import { SourceJournal, LIMITS } from './source-journal';
import { bytes } from './bounded-note-service';

it('pages every outside-start overlap instead of silently stopping after eight anchors', () => {
  const service = new SourceJournal(() => 'café 🌍 repeated '.repeat(2000), 1);
  service.anchors = Array.from({ length: 40 }, (_, i) => ({
    id: `cross-${i}`,
    from: 3900 - i,
    to: 4400 + i,
    alive: true,
  }));
  const ids: string[] = [];
  let cursor: unknown;
  do {
    const page = Reflect.apply(service.annotations, service, [
      4096,
      4300,
      service.revision,
      service.generation,
      { commentRevision: service.commentRevision, cursor, limit: 8 },
    ]) as ReturnType<SourceJournal['annotations']> & { next?: unknown };
    expect(bytes(JSON.stringify(page))).toBeLessThanOrEqual(LIMITS.request);
    expect(page.items.length).toBeLessThanOrEqual(8);
    ids.push(...page.items.map((a) => a.id));
    cursor = page.next;
  } while (cursor);
  expect(ids).toEqual(Array.from({ length: 40 }, (_, i) => `cross-${i}`));
});

it('rejects a stale independent comment revision without a source or attribution change', () => {
  const service = new SourceJournal(() => 'repeated café 🌍', 1);
  const commentRevision = service.commentRevision;
  service.commentRevision++;
  expect(() =>
    Reflect.apply(service.annotations, service, [
      0,
      service.length,
      service.revision,
      service.generation,
      { commentRevision, limit: 8 },
    ]),
  ).toThrow('Stale annotations');
});

it('history bookmark transfer does not hydrate the whole anchor collection', () => {
  const service = new SourceJournal(() => 'repeated café 🌍', 1);
  const anchors = Array.from({ length: 2000 }, (_, i) => ({
    id: `thread-${i}`,
    from: 0,
    to: 4,
    alive: true,
  }));
  const point = { anchor: 2, head: 2, revision: 1, affinity: 1 as const };
  service.record(
    { changes: [], before: point, after: point, anchorsBefore: anchors, anchorsAfter: anchors },
    false,
  );
  expect(bytes(JSON.stringify(service.event(0)))).toBeLessThanOrEqual(LIMITS.journalPage);
  expect(service.event(0).before).toEqual(point);
});

it('binds continuation to its source, query range and all independent epochs', () => {
  const service = new SourceJournal(() => 'repeated '.repeat(1000), 1);
  service.anchors = Array.from({ length: 20 }, (_, i) => ({
    id: `cmt-${i}`,
    from: 0,
    to: 100,
    alive: true,
  }));
  const cursor = service.annotations(0, 100, 1, 1).next!;
  expect(cursor).toBeDefined();
  expect(() => service.annotations(1, 100, 1, 1, { cursor })).toThrow('Stale annotations cursor');
  const other = new SourceJournal(() => 'repeated '.repeat(1000), 1);
  other.anchors = service.anchors;
  expect(() => other.annotations(0, 100, 1, 1, { cursor })).toThrow('Stale annotations cursor');
  for (const field of ['revision', 'generation', 'commentRevision'] as const) {
    service[field]++;
    expect(() =>
      service.annotations(0, 100, service.revision, service.generation, { cursor }),
    ).toThrow('Stale annotations cursor');
    service[field]--;
  }
});

it('keeps attribution tied to its source revision while comment-only changes leave it usable', () => {
  const service = new SourceJournal(() => 'repeated café 🌍', 1);
  service.anchors = [];
  service.replaceAttribution(1, 1, [
    { id: 'author-1', from: 0, to: 8, alive: true, authorId: 'agent-1' },
  ]);
  service.commentRevision++;
  expect(service.annotations(0, 12, 1, 2).items).toMatchObject([
    { id: 'author-1', sourceRevision: 1 },
  ]);
  service.apply({ from: 0, to: 0, insert: 'X' });
  expect(service.annotations(0, 12, 2, 2).items).toEqual([]);
  expect(() => service.replaceAttribution(1, 2, [])).toThrow('Stale attribution');
  service.replaceAttribution(2, 2, [{ id: 'author-1', from: 1, to: 9, alive: true }]);
  expect(service.annotations(0, 12, 2, 3).items).toMatchObject([
    { from: 1, to: 9, sourceRevision: 2 },
  ]);
});

it('retains paged Unicode dirty drafts through source edits, orphaning and comment conflicts', () => {
  const source = '<!--anchor:cmt-a:start-->repeated<!--anchor:cmt-a:end--> following';
  const service = new SourceJournal(() => source, 1);
  service.anchors = [];
  service.registerComment('cmt-a');
  const chunk = 'draft café 🌍 '.repeat(90);
  for (let i = 0; i < 12; i++)
    service.stageCommentDraft('cmt-a', i * chunk.length, i * chunk.length, chunk);
  const collect = () => {
    let text = '',
      at = 0;
    do {
      const page = service.commentDraftPage('cmt-a', at)!;
      expect(bytes(JSON.stringify(page))).toBeLessThanOrEqual(4096);
      expect(page.text).not.toMatch(/[\uD800-\uDBFF]$/);
      text += page.text;
      if (page.next === undefined) return text;
      at = page.next;
    } while (true);
  };
  expect(collect()).toBe(chunk.repeat(12));
  service.apply({ from: 0, to: source.indexOf(' following'), insert: '' });
  expect(
    service.annotations(0, service.length, service.revision, service.generation).items,
  ).toEqual([]);
  service.commentRevision++;
  expect(() => service.publishCommentDraft('cmt-a', service.commentRevision)).toThrow(
    'Comment draft conflict',
  );
  expect(collect()).toBe(chunk.repeat(12));
  expect(service.maxCommentDraftPageBytes).toBeLessThanOrEqual(4096);
  expect(service.stats.backingCommentDraftBytes).toBeGreaterThan(16384);
});

it('never admits a partial canonical marker at a transport crop edge', () => {
  const marker = '<!--anchor:cmt-a:start-->';
  const source = 'prefix ' + marker + 'repeated';
  const service = new SourceJournal(() => source, 1);
  const inside = 12;
  expect(service.inlineBoundary(inside, 1)).toBe(7 + marker.length);
  expect(service.inlineBoundary(inside, -1)).toBe(7);
});
