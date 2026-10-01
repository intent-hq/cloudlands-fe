/** Test-only service: lazy indexed regions, not a proposed daemon wire schema. */
export const REGION_COUNT = 10_000;
export const MAX_REGION_BYTES = 8192;
export const MAX_PAGE_BYTES = 4096;
export const MAX_RETAINED_REGIONS = 4;
const encoder = new TextEncoder();
export const bytes = (text: string) => encoder.encode(text).length;

export function sourceFor(index: number): string {
  return `Region ${index} — café 🌍.\n\nPage one boundary.\n\nPage two boundary.\n\n- Parent\n  - Nested child\n\n| Name | Value |\n| --- | --- |\n| Cell | Editable |\n\n${'long text '.repeat(180)}\n`;
}

export interface RegionPage {
  id: number;
  revision: number;
  offset: number;
  next: number | null;
  source: string;
}
export interface Mutation {
  id: number;
  expectedRevision: number;
  operationId: string;
  source: string;
}
export interface Annotation {
  id: string;
  kind: 'comment' | 'attribution';
  /** UTF-16 source positions, not ProseMirror positions. */
  from: number;
  to: number;
}

export class BoundedNoteService {
  private regions = new Map<number, { revision: number; source: string }>();
  private receipts = new Map<string, { request: string; revision: number }>();
  readonly calls: Array<{ method: string; id: number; offset?: number; bytes: number }> = [];
  failNextWrite = false;

  private region(id: number) {
    if (!Number.isInteger(id) || id < 0 || id >= REGION_COUNT) throw new Error('Invalid region');
    return this.regions.get(id) ?? { revision: 1, source: sourceFor(id) };
  }

  read(id: number, offset = 0, expectedRevision?: number): RegionPage {
    const region = this.region(id);
    if (expectedRevision !== undefined && expectedRevision !== region.revision)
      throw new Error('Stale revision');
    if (bytes(region.source) > MAX_REGION_BYTES) throw new Error('Oversized atomic region');
    // Deliberately make the first transport page end between two paragraphs.
    const firstEnd = region.source.indexOf('Page two boundary.');
    let end = offset === 0 && firstEnd > 0 ? firstEnd : region.source.length;
    while (bytes(region.source.slice(offset, end)) > MAX_PAGE_BYTES) {
      end -= 1;
      if (/^[\uDC00-\uDFFF]$/.test(region.source[end])) end -= 1;
    }
    if (offset < 0 || offset >= region.source.length || end <= offset)
      throw new Error('Invalid cursor');
    const source = region.source.slice(offset, end);
    this.calls.push({ method: 'read', id, offset, bytes: bytes(source) });
    return {
      id,
      revision: region.revision,
      offset,
      next: end < region.source.length ? end : null,
      source,
    };
  }

  annotations(id: number, revision: number, from: number, to: number, limit: number) {
    const region = this.region(id);
    if (revision !== region.revision) throw new Error('Stale annotations');
    if (limit < 1 || limit > 8 || from < 0 || to - from > MAX_REGION_BYTES)
      throw new Error('Unbounded annotations');
    const start = region.source.indexOf('Page one boundary.');
    const end = region.source.indexOf('Page two boundary.') + 'Page two boundary.'.length;
    const entries: Annotation[] =
      start < 0 || end < start
        ? []
        : [
            { id: `thread-${id}`, kind: 'comment', from: start, to: end },
            { id: `author-${id}`, kind: 'attribution', from: start, to: start + 18 },
          ];
    // Real storage must execute overlap filtering and limit BEFORE decoding.
    const items = entries.filter((entry) => entry.from < to && entry.to > from).slice(0, limit);
    const result = { sourceRevision: revision, generation: 1, commentRevision: 1, items };
    this.calls.push({ method: 'annotations', id, bytes: bytes(JSON.stringify(result)) });
    return result;
  }

  write(request: Mutation): number {
    const payload = JSON.stringify(request);
    const receipt = this.receipts.get(request.operationId);
    if (receipt) {
      if (receipt.request !== payload) throw new Error('Operation ID reused');
      return receipt.revision;
    }
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('Offline');
    }
    const region = this.region(request.id);
    if (region.revision !== request.expectedRevision) throw new Error('Write conflict');
    if (bytes(request.source) > MAX_REGION_BYTES) throw new Error('Oversized atomic region');
    const revision = region.revision + 1;
    this.regions.set(request.id, { revision, source: request.source });
    this.receipts.set(request.operationId, { request: payload, revision });
    this.calls.push({ method: 'write', id: request.id, bytes: bytes(request.source) });
    return revision;
  }
}
