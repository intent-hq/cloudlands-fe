import { describe, expect, it } from 'vitest';
import {
  BoundedNoteService,
  MAX_PAGE_BYTES,
  MAX_REGION_BYTES,
  bytes,
  sourceFor,
} from './bounded-note-service';

describe('bounded fake note contract (not daemon integration)', () => {
  it('reconstructs exact Unicode source with bounded pages at one revision', () => {
    const service = new BoundedNoteService();
    let source = '';
    let cursor: number | null = 0;
    while (cursor !== null) {
      const page = service.read(9876, cursor, 1);
      expect(bytes(page.source)).toBeLessThanOrEqual(MAX_PAGE_BYTES);
      source += page.source;
      cursor = page.next;
    }
    expect(source).toBe(sourceFor(9876));
    expect(service.calls).toHaveLength(2);
  });

  it('preserves unloaded content and makes retries idempotent', () => {
    const service = new BoundedNoteService();
    const write = { id: 0, expectedRevision: 1, operationId: 'a', source: 'Changed 🌍' };
    expect(service.write(write)).toBe(2);
    expect(service.write(write)).toBe(2);
    expect(service.read(0).source).toBe('Changed 🌍');
    expect(service.read(9999).source).toBe(sourceFor(9999).split('Page two boundary.')[0]);
    expect(() => service.write({ ...write, source: 'Other' })).toThrow('Operation ID reused');
    expect(() => service.write({ ...write, operationId: 'b' })).toThrow('Write conflict');
  });

  it('rejects mixed revisions and stale annotation results', () => {
    const service = new BoundedNoteService();
    const first = service.read(0);
    service.write({
      id: 0,
      expectedRevision: 1,
      operationId: 'remote',
      source: sourceFor(0) + 'Remote',
    });
    expect(() => service.read(0, first.next!, 1)).toThrow('Stale revision');
    expect(() => service.annotations(0, 1, 0, 100, 8)).toThrow('Stale annotations');
  });

  it('queries overlapping anchors, including anchors starting in the previous page', () => {
    const service = new BoundedNoteService();
    const boundary = service.read(0).next!;
    const result = service.annotations(0, 1, boundary, boundary + 18, 8);
    expect(result.items).toEqual([
      {
        id: 'thread-0',
        kind: 'comment',
        from: sourceFor(0).indexOf('Page one'),
        to: boundary + 18,
      },
    ]);
    expect(result).toMatchObject({ sourceRevision: 1, generation: 1, commentRevision: 1 });
    expect(() => service.annotations(0, 1, 0, 100, 1000)).toThrow('Unbounded');
  });

  it('fails oversized atomic writes explicitly; it cannot solve arbitrary long blocks', () => {
    const service = new BoundedNoteService();
    expect(() =>
      service.write({
        id: 0,
        expectedRevision: 1,
        operationId: 'big',
        source: 'x'.repeat(MAX_REGION_BYTES + 1),
      }),
    ).toThrow('Oversized');
    expect(service.read(0).revision).toBe(1);
  });
});
