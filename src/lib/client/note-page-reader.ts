import type { NotePageRequest, NoteReadPage, NotePagingCapabilities } from './note-pages';
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const token = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && new TextEncoder().encode(s).length <= 256;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid note page object');
  return value as Record<string, unknown>;
}
function scope(value: unknown, workspaceId: string, noteId: string) {
  const s = object(value);
  if (
    s.workspaceId !== workspaceId ||
    s.noteId !== noteId ||
    !token(s.backendId) ||
    !token(s.noteInstanceId)
  )
    throw new Error('Mismatched note page scope');
}
const uint = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
function range(value: unknown) {
  const r = object(value);
  if (!uint(r.start) || !uint(r.end) || r.end < r.start)
    throw new Error('Invalid note source address');
}
function pageItem(value: unknown, kind: NotePageRequest['kind']) {
  const i = object(value);
  if (kind === 'taskIds') {
    range(i.sourceRange);
    if (
      !uint(i.index) ||
      !uint(i.taskNoteIdLength) ||
      i.taskNoteIdLength !==
        (i.sourceRange as { start: number; end: number }).end -
          (i.sourceRange as { start: number; end: number }).start ||
      [i.taskNoteId !== undefined, i.taskNoteIdRef !== undefined].filter(Boolean).length !== 1 ||
      (i.taskNoteId !== undefined && !token(i.taskNoteId)) ||
      (i.taskNoteIdRef !== undefined && !token(i.taskNoteIdRef))
    )
      throw new Error('Invalid task link descriptor');
    return;
  }
  if (kind === 'mapping') {
    range(i);
    if (!uint(i.insertedLength)) throw new Error('Invalid note mapping');
    return;
  }
  if (kind === 'effects') {
    if (i.kind === 'createdTask' && token(i.taskNoteId)) return;
    if (
      i.kind === 'warning' &&
      token(i.code) &&
      typeof i.messagePreview === 'string' &&
      typeof i.truncated === 'boolean'
    )
      return;
    if (
      i.kind === 'annotationInvalidation' &&
      token(i.sourceRevision) &&
      token(i.attributionGeneration) &&
      token(i.commentRevision)
    )
      return;
    if (
      i.kind === 'sourceEffect' &&
      ['task-conversion', 'anchor-repair', 'phantom-scrub', 'task-marker-projection'].includes(
        String(i.reason),
      ) &&
      token(i.inputState) &&
      token(i.outputState) &&
      uint(i.insertedLength) &&
      token(i.beforeDigest) &&
      token(i.afterDigest) &&
      token(i.detailRef)
    ) {
      range(i.range);
      return;
    }
    throw new Error('Invalid note effect');
  }
  if (!token(i.id)) throw new Error('Invalid note descriptor identity');
  if (kind === 'metadata') {
    if (i.parentId !== null && !token(i.parentId)) throw new Error('Invalid metadata parent');
    if (
      i.parentId !== null &&
      [i.key !== undefined, i.keyRef !== undefined, i.index !== undefined].filter(Boolean)
        .length !== 1
    )
      throw new Error('Invalid metadata address');
    if (
      (i.key !== undefined && typeof i.key !== 'string') ||
      (i.index !== undefined && !uint(i.index))
    )
      throw new Error('Invalid metadata key');
    if (i.type === 'object' || i.type === 'array') {
      if (!token(i.childrenRef)) throw new Error('Invalid metadata children');
    } else if (i.type === 'string') {
      if (typeof i.value !== 'string' && !token(i.valueRef))
        throw new Error('Invalid metadata string');
    } else if (i.type === 'number') {
      if (typeof i.value !== 'number' || !Number.isFinite(i.value))
        throw new Error('Invalid metadata number');
    } else if (i.type === 'boolean') {
      if (typeof i.value !== 'boolean') throw new Error('Invalid metadata boolean');
    } else if (i.type !== 'null' || i.value !== null) throw new Error('Invalid metadata type');
    return;
  }
  if (i.kind === 'fragment') {
    if (
      typeof i.field !== 'string' ||
      !uint(i.offset) ||
      typeof i.text !== 'string' ||
      new TextEncoder().encode(i.text).length > 16384 ||
      (i.nextRef !== null && !token(i.nextRef))
    )
      throw new Error('Invalid context fragment');
  } else {
    range(i.sourceRange);
    if (i.kind === 'boundary') {
      if (
        typeof i.construct !== 'string' ||
        typeof i.continuationBefore !== 'boolean' ||
        typeof i.continuationAfter !== 'boolean'
      )
        throw new Error('Invalid context boundary');
    } else if (i.kind !== 'span' || typeof i.role !== 'string')
      throw new Error('Invalid context span');
  }
}
function readPage(
  value: unknown,
  workspaceId: string,
  noteId: string,
  request: NotePageRequest,
): NoteReadPage {
  const p = object(value);
  scope(p.scope, workspaceId, noteId);
  const kind = {
    source: 'noteSourcePage',
    taskIds: 'noteTaskIdsPage',
    context: 'noteContextPage',
    metadata: 'noteMetadataPage',
    mapping: 'noteMappingPage',
    effects: 'noteEffectsPage',
  }[request.kind];
  if (
    p.kind !== kind ||
    'note' in p ||
    'content' in p ||
    bytes(value) > (request.maxWireBytes ?? 65536)
  )
    throw new Error('Invalid note page response');
  if (p.nextCursor !== null && !token(p.nextCursor)) throw new Error('Invalid note page cursor');
  if (request.kind === 'mapping' || request.kind === 'effects') {
    if (
      p.operationId !== request.operationId ||
      !token(p.beforeRevision) ||
      !token(p.afterRevision)
    )
      throw new Error('Invalid receipt page identity');
  } else if (
    !token(p.sourceRevision) ||
    !token(p.snapshotId) ||
    typeof p.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(p.expiresAt))
  )
    throw new Error('Invalid note snapshot');
  if (request.kind === 'source') {
    const r = object(p.range);
    const start = r.start as number,
      end = r.end as number,
      length = p.sourceLength as number;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      !Number.isSafeInteger(length) ||
      start < 0 ||
      end < start ||
      end > length ||
      typeof p.text !== 'string' ||
      p.text.length !== end - start ||
      new TextEncoder().encode(p.text).length > (request.maxSourceBytes ?? 16384) ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(p.text) ||
      !token(p.contextRef) ||
      !token(p.metadataRef) ||
      (p.nextCursor === null) !== (end === length) ||
      (p.previousCursor === null) !== (start === 0) ||
      (p.previousCursor !== null && !token(p.previousCursor))
    )
      throw new Error('Invalid note source range');
  } else if (!Array.isArray(p.items) || p.items.length > (request.maxItems ?? 128))
    throw new Error('Invalid note page items');
  if (
    request.kind === 'taskIds' &&
    (!uint(p.totalItems) ||
      !uint(p.startIndex) ||
      p.startIndex + (p.items as unknown[]).length > p.totalItems ||
      (p.nextCursor === null) !== (p.startIndex + (p.items as unknown[]).length === p.totalItems))
  )
    throw new Error('Invalid task link count');
  if (Array.isArray(p.items)) for (const item of p.items) pageItem(item, request.kind);
  if (
    (request.kind === 'source' || request.kind === 'taskIds') &&
    ((request.sourceRevision !== undefined && p.sourceRevision !== request.sourceRevision) ||
      (request.snapshotId !== undefined && p.snapshotId !== request.snapshotId) ||
      (request.noteInstanceId !== undefined &&
        object(p.scope).noteInstanceId !== request.noteInstanceId))
  )
    throw new Error('Mismatched requested snapshot');
  return value as NoteReadPage;
}
function validateRequest(page: NotePageRequest) {
  for (const [name, min, max] of [
    ['maxWireBytes', 4096, 65536],
    ['maxItems', 1, 128],
    ['maxSourceBytes', 4, 16384],
  ] as const) {
    const value =
      name === 'maxSourceBytes'
        ? page.kind === 'source'
          ? page.maxSourceBytes
          : undefined
        : page[name];
    if (value !== undefined && (!uint(value) || value < min || value > max))
      throw new Error('Invalid note page budget');
  }
  if (page.kind === 'source' && page.at !== undefined && !uint(page.at))
    throw new Error('Invalid note seek address');
}

export class NotePageReader {
  constructor(
    private readonly request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  ) {}
  async capabilities(): Promise<NotePagingCapabilities | null> {
    const hello = (await this.request('client.hello', {})) as {
      server?: {
        capabilities?: {
          notePaging?: number;
          noteAnnotations?: number;
          notePagingBackendId?: string;
        };
      };
    } | null;
    const c = hello?.server?.capabilities;
    return c?.notePaging === 1 && token(c.notePagingBackendId)
      ? { backendId: c.notePagingBackendId, annotations: c.noteAnnotations === 1 }
      : null;
  }
  async read(workspaceId: string, noteId: string, page: NotePageRequest): Promise<NoteReadPage> {
    validateRequest(page);
    return readPage(
      await this.request('note.get', { workspaceId, noteId, page }),
      workspaceId,
      noteId,
      page,
    );
  }
}
