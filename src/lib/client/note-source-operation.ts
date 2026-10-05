import type { NoteScope } from './note-pages';

/** Source-only staged reads. Selection/rendered output and mutations need their
 * own validated producers; none fall back to this adapter. */
export interface NoteSourceOperationInput {
  scope: NoteScope;
  operationId: string;
  expiresAt: string;
  header: {
    baseRevision: string;
    editorSessionId: string;
    localEditSequence: number;
    liveGeneration: number;
    selectionGeneration: number;
    action: 'read';
    output: 'source';
    selection: 'all';
  };
}
export type NoteStagedSaveInput = Omit<NoteSourceOperationInput, 'header'> & {
  header: Omit<NoteSourceOperationInput['header'], 'action'> & { action: 'mutate' };
};
/** Bounded configured-native selection output. expectedOutput is local validation
 * state, never a wire field or a source/native authority supplied by the server. */
export type NoteSelectionOperationInput = Omit<NoteSourceOperationInput, 'header'> & {
  header: Omit<NoteSourceOperationInput['header'], 'output' | 'selection'> & {
    output: 'selectionMarkdown';
    selection: 'ranges';
  };
  expectedOutput: string;
};
export type NoteRenderedSearchOperationInput = Omit<NoteSourceOperationInput, 'header'> & {
  header: Omit<NoteSourceOperationInput['header'], 'output' | 'selection'> & {
    output: 'search';
    selection: 'ranges';
    query: { text: string; caseSensitive: false; mode: 'renderedText' };
  };
};
export interface NoteRenderedOperationPage {
  items: unknown[];
  nextCursor: string | null;
  scannedThrough?: unknown;
  count?: unknown;
}
interface NoteStageTextReference {
  textId: string;
  length: number;
  utf8Bytes: number;
  sha256: string;
}
type NoteSourceStageRecord =
  | { kind: 'text'; id: string; offset: number; text: string }
  | {
      kind: 'splice';
      localSequence: number;
      ordinal: number;
      start: number;
      end: number;
      replacement: NoteStageTextReference;
    };
type NoteSelectionStageRecord =
  | {
      kind: 'range';
      ordinal: number;
      start: number;
      end: number;
      anchorAffinity: 'before' | 'after';
      headAffinity: 'before' | 'after';
      direction: 'forward' | 'backward';
    }
  | {
      kind: 'projection';
      ordinal: number;
      sourceRange: { start: number; end: number };
      role: 'selection-owner' | 'inline-span';
      detail: NoteStageTextReference;
    };
type NoteMarkerStageRecord = {
  kind: 'projection';
  ordinal: number;
  sourceRange: { start: number; end: number };
  role: 'selection-owner' | 'marker-occurrence';
  canonicalId?: string;
  detail: NoteStageTextReference;
};
const streams = ['text', 'dirty', 'selection', 'mutation', 'live'] as const;
const encoder = new TextEncoder();
const size = (s: string) => encoder.encode(s).length;
const uint = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export const validStageText = (v: unknown): v is string =>
  typeof v === 'string' &&
  !/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
const token = (v: unknown): v is string =>
  validStageText(v) && v.length > 0 && v.length <= 256 && size(v) <= 256;
const digest = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid staged object');
  return v as Record<string, unknown>;
}
// Inputs are freshly constructed bounded records, not arbitrary metadata graphs.
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}
export async function stageTextDigest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
const hash = (v: unknown) => stageTextDigest(canonical(v));

/** One serial transport owner. Caller admits DATA before construction/hashing and
 * retains it through every request, sink and cancel settlement. This class never
 * commits a note, retries an uncertain chunk or activates a capability. */
export function createNoteSourceOperation(
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  input: NoteSourceOperationInput,
  current: () => boolean,
  now: () => number = Date.now,
) {
  return createSourceStage(send, input, current, now, 'read', 'source');
}

/** Clean native marker correspondence upload. Backend seal alone establishes
 * original occurrence ownership; this adapter cannot authorize a marker. */
export function createNoteMarkerSourceOperation(
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  input: NoteSourceOperationInput,
  current: () => boolean,
  now: () => number = Date.now,
) {
  return createSourceStage(send, input, current, now, 'read', 'source', true);
}

export function createNoteSelectionOperation(
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  input: NoteSelectionOperationInput,
  current: () => boolean,
  now: () => number = Date.now,
) {
  return createSourceStage(send, input, current, now, 'read', 'selectionMarkdown');
}

export function createNoteRenderedSearchOperation(
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  input: NoteRenderedSearchOperationInput,
  current: () => boolean,
  now: () => number = Date.now,
) {
  return createSourceStage(send, input, current, now, 'read', 'search');
}

/** Dirty-only save staging. The caller proves native grouping and owns commit.
 * There is no mutation, selection or live projection fallback. */
export function createNoteStagedSaveOperation(
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  input: NoteStagedSaveInput,
  current: () => boolean,
  now: () => number = Date.now,
) {
  return createSourceStage(send, input, current, now, 'mutate', 'source');
}
function createSourceStage(
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  input:
    | NoteSourceOperationInput
    | NoteStagedSaveInput
    | NoteSelectionOperationInput
    | NoteRenderedSearchOperationInput,
  current: () => boolean,
  now: () => number,
  action: 'read' | 'mutate',
  output: 'source' | 'selectionMarkdown' | 'search',
  marker = false,
) {
  const scope = Object.freeze({
    backendId: input.scope.backendId,
    workspaceId: input.scope.workspaceId,
    noteId: input.scope.noteId,
    noteInstanceId: input.scope.noteInstanceId,
  });
  // Keep selection output fragmented within the supported native paragraph;
  // whole-source streaming retains its existing page budget.
  const readBytes = output === 'selectionMarkdown' ? 1024 : 4096;
  const h = input.header;
  if (
    h.action !== action ||
    h.output !== output ||
    h.selection !== (output === 'source' ? 'all' : 'ranges') ||
    (output === 'search' ? !('query' in h) : 'query' in h)
  )
    throw new Error('Unsupported staged output');
  const expectedOutput =
    output === 'selectionMarkdown' && 'expectedOutput' in input ? input.expectedOutput : undefined;
  if (
    output === 'selectionMarkdown' &&
    (!validStageText(expectedOutput) ||
      !expectedOutput.length ||
      expectedOutput.length > 4096 ||
      size(expectedOutput) > 16384)
  )
    throw new Error('Invalid captured selection output');
  const query =
    output === 'search' && 'query' in h
      ? Object.freeze({
          text: h.query.text,
          caseSensitive: h.query.caseSensitive,
          mode: h.query.mode,
        })
      : undefined;
  if (
    output === 'search' &&
    (!query ||
      !validStageText(query.text) ||
      !query.text.length ||
      query.text.length > 1024 ||
      size(query.text) > 1024 ||
      query.caseSensitive !== false ||
      query.mode !== 'renderedText')
  )
    throw new Error('Invalid rendered search query');
  const header = Object.freeze({
    baseRevision: h.baseRevision,
    editorSessionId: h.editorSessionId,
    localEditSequence: h.localEditSequence,
    liveGeneration: h.liveGeneration,
    selectionGeneration: h.selectionGeneration,
    action: h.action,
    output: h.output,
    selection: h.selection,
    ...(query ? { query } : {}),
  });
  const { operationId, expiresAt } = input;
  const deadline = Date.parse(expiresAt);
  if (
    !Object.values(scope).every(token) ||
    !token(header.baseRevision) ||
    !token(header.editorSessionId) ||
    ![header.localEditSequence, header.liveGeneration, header.selectionGeneration].every(uint) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(operationId) ||
    !Number.isFinite(deadline) ||
    new Date(deadline).toISOString() !== expiresAt ||
    deadline <= now() ||
    deadline - now() > 86_400_000
  )
    throw new Error('Invalid staged source identity');
  const manifest = streams.map((stream) => ({
    stream,
    chunks: 0,
    records: 0,
    lastDigest: null as string | null,
  }));
  let headerDigest: string | undefined, payloadDigest: string | undefined;
  let begun = false,
    sealed = false,
    cancelled = false,
    busy = false,
    revoked = false;
  let viewLength: number | undefined, viewId: string | undefined, cursor: string | undefined;
  let offset = 0,
    done = false;
  const check = () => {
    revoked ||= !current() || now() >= deadline;
    if (revoked || cancelled) throw new Error('Staged source owner expired or superseded');
  };
  const identity = () => ({ ...scope, operationId, headerDigest });
  const rpc = async (method: string, params: Record<string, unknown>, cleanup = false) => {
    if (!cleanup) check();
    if (size(JSON.stringify({ jsonrpc: '2.0', id: '\0'.repeat(64), method, params })) > 65536)
      throw new Error('Staged request frame exceeded');
    const result = await send(method, params);
    if (!cleanup) check();
    return record(result);
  };
  const envelope = (p: Record<string, unknown>, limit: number) => {
    const s = record(p.scope);
    if (
      Object.entries(scope).some(([k, v]) => s[k] !== v) ||
      p.operationId !== operationId ||
      size(JSON.stringify(p)) > limit
    )
      throw new Error('Mismatched staged envelope');
  };
  const state = (p: Record<string, unknown>, phase: string) => {
    envelope(p, 4096);
    if (
      p.kind !== 'noteStageState' ||
      p.headerDigest !== headerDigest ||
      p.phase !== phase ||
      p.baseRevision !== header.baseRevision ||
      p.expiresAt !== expiresAt ||
      !Array.isArray(p.streams) ||
      p.streams.length !== 5 ||
      p.streams.some((entry, i) => {
        const s = record(entry),
          expected = manifest[i];
        return (
          s.stream !== expected.stream ||
          !uint(s.nextSequence) ||
          (s.lastDigest !== null && !digest(s.lastDigest)) ||
          (phase !== 'cancelled' &&
            (s.nextSequence !== expected.chunks || s.lastDigest !== expected.lastDigest))
        );
      }) ||
      (phase === 'sealed' && (p.payloadDigest !== payloadDigest || !uint(p.viewLength)))
    )
      throw new Error('Mismatched staged state');
  };
  const exclusive = async <T>(run: () => Promise<T>): Promise<T> => {
    if (busy) throw new Error('Staged operation already in flight');
    busy = true;
    try {
      return await run();
    } catch (error) {
      revoked = true;
      throw error;
    } finally {
      busy = false;
    }
  };
  return {
    sealedSave() {
      check();
      if (
        action !== 'mutate' ||
        !sealed ||
        !headerDigest ||
        !payloadDigest ||
        viewLength === undefined
      )
        throw new Error('Staged save identity unavailable');
      return Object.freeze({
        scope,
        baseRevision: header.baseRevision,
        operationId,
        expiresAt,
        headerDigest,
        payloadDigest,
        viewLength,
        manifest: Object.freeze(manifest.map((m) => Object.freeze({ ...m }))),
      });
    },
    async begin() {
      return exclusive(async () => {
        check();
        if (begun) throw new Error('Staged operation already begun');
        headerDigest = await hash({
          method: 'note.operation.begin',
          ...scope,
          operationId,
          expiresAt,
          header,
        });
        check();
        begun = true; // Includes a lost acknowledgement: finally must cancel this exact identity.
        const p = await rpc('note.operation.begin', { ...identity(), expiresAt, header });
        state(p, 'staging');
        check();
      });
    },
    async append(
      stream: 'text' | 'dirty' | 'selection' | 'live',
      original: readonly (
        NoteSourceStageRecord | NoteSelectionStageRecord | NoteMarkerStageRecord
      )[],
    ) {
      return exclusive(async () => {
        check();
        if (
          !begun ||
          sealed ||
          !(
            marker
              ? ['text', 'live']
              : output === 'source'
                ? ['text', 'dirty']
                : ['text', 'selection', 'live']
          ).includes(stream) ||
          original.length < 1 ||
          original.length > 128
        )
          throw new Error('Invalid staged append');
        let textBytes = 0;
        const records = original.map((r, index) => {
          if (stream === 'text' && r.kind === 'text') {
            if (!token(r.id) || !uint(r.offset) || !validStageText(r.text) || r.text.length > 16384)
              throw new Error('Invalid staged text');
            textBytes += size(r.text);
            return { kind: r.kind, id: r.id, offset: r.offset, text: r.text };
          }
          if (output !== 'source' && stream === 'selection' && r.kind === 'range') {
            if (
              r.ordinal !== manifest[2].records + index ||
              r.ordinal !== 0 ||
              ![r.start, r.end].every(uint) ||
              (output === 'search' ? r.end < r.start : r.end <= r.start) ||
              !['before', 'after'].includes(r.anchorAffinity) ||
              !['before', 'after'].includes(r.headAffinity) ||
              !['forward', 'backward'].includes(r.direction)
            )
              throw new Error('Invalid captured selection range');
            return {
              kind: r.kind,
              ordinal: r.ordinal,
              start: r.start,
              end: r.end,
              anchorAffinity: r.anchorAffinity,
              headAffinity: r.headAffinity,
              direction: r.direction,
            };
          }
          if (marker && stream === 'live' && r.kind === 'projection') {
            const id = 'canonicalId' in r ? r.canonicalId : undefined;
            if (
              ![r.ordinal, r.sourceRange.start, r.sourceRange.end].every(uint) ||
              r.ordinal !== manifest[4].records + index ||
              r.ordinal > 1 ||
              r.sourceRange.end <= r.sourceRange.start ||
              r.role !== (r.ordinal === 0 ? 'selection-owner' : 'marker-occurrence') ||
              (r.ordinal === 0 ? id !== undefined : !token(id)) ||
              !token(r.detail.textId) ||
              !uint(r.detail.length) ||
              !uint(r.detail.utf8Bytes) ||
              !digest(r.detail.sha256)
            )
              throw new Error('Invalid captured marker projection');
            return {
              kind: r.kind,
              ordinal: r.ordinal,
              role: r.role,
              sourceRange: { start: r.sourceRange.start, end: r.sourceRange.end },
              ...(id === undefined ? {} : { canonicalId: id }),
              detail: {
                textId: r.detail.textId,
                length: r.detail.length,
                utf8Bytes: r.detail.utf8Bytes,
                sha256: r.detail.sha256,
              },
            };
          }
          if (output !== 'source' && stream === 'live' && r.kind === 'projection') {
            if (
              ![r.ordinal, r.sourceRange.start, r.sourceRange.end].every(uint) ||
              r.ordinal > 1 ||
              r.ordinal !== manifest[4].records + index ||
              r.sourceRange.end <= r.sourceRange.start ||
              r.role !== (r.ordinal === 0 ? 'selection-owner' : 'inline-span') ||
              !token(r.detail.textId) ||
              !uint(r.detail.length) ||
              !uint(r.detail.utf8Bytes) ||
              !digest(r.detail.sha256)
            )
              throw new Error('Invalid captured selection projection');
            return {
              kind: r.kind,
              ordinal: r.ordinal,
              role: r.role,
              sourceRange: { start: r.sourceRange.start, end: r.sourceRange.end },
              detail: {
                textId: r.detail.textId,
                length: r.detail.length,
                utf8Bytes: r.detail.utf8Bytes,
                sha256: r.detail.sha256,
              },
            };
          }
          if (
            stream !== 'dirty' ||
            r.kind !== 'splice' ||
            ![r.localSequence, r.ordinal, r.start, r.end].every(uint) ||
            r.end < r.start ||
            r.localSequence > header.localEditSequence ||
            !token(r.replacement.textId) ||
            !uint(r.replacement.length) ||
            !uint(r.replacement.utf8Bytes) ||
            !digest(r.replacement.sha256)
          )
            throw new Error('Invalid staged dirty record');
          return {
            kind: r.kind,
            localSequence: r.localSequence,
            ordinal: r.ordinal,
            start: r.start,
            end: r.end,
            replacement: {
              textId: r.replacement.textId,
              length: r.replacement.length,
              utf8Bytes: r.replacement.utf8Bytes,
              sha256: r.replacement.sha256,
            },
          };
        });
        if (textBytes > 16384) throw new Error('Staged text chunk exceeded');
        const m = manifest[streams.indexOf(stream)];
        if (
          (output !== 'source' || marker) &&
          ((stream === 'selection' && m.records + records.length > 1) ||
            (stream === 'live' && m.records + records.length > 2))
        )
          throw new Error('Captured selection record count exceeded');
        const chunk = { stream, sequence: m.chunks, previousDigest: m.lastDigest, records };
        if (size(canonical(chunk)) > 60000) throw new Error('Staged chunk exceeded');
        const chunkDigest = await hash(chunk);
        const p = await rpc('note.operation.append', { ...identity(), ...chunk, chunkDigest });
        envelope(p, 4096);
        if (
          p.kind !== 'noteStageAck' ||
          p.stream !== stream ||
          p.sequence !== m.chunks ||
          p.nextSequence !== m.chunks + 1 ||
          p.chunkDigest !== chunkDigest
        )
          throw new Error('Mismatched staged acknowledgement');
        check();
        m.chunks++;
        m.records += records.length;
        m.lastDigest = chunkDigest;
      });
    },
    async seal() {
      return exclusive(async () => {
        check();
        if (!begun || sealed) throw new Error('Staged seal unavailable');
        if (
          marker &&
          (manifest[1].records !== 0 ||
            manifest[2].records !== 0 ||
            manifest[3].records !== 0 ||
            manifest[4].records !== 2)
        )
          throw new Error('Incomplete captured marker manifest');
        if (output !== 'source' && (manifest[2].records !== 1 || manifest[4].records !== 2))
          throw new Error('Incomplete captured selection manifest');
        payloadDigest = await hash({ headerDigest, manifest });
        const p = await rpc('note.operation.seal', { ...identity(), manifest, payloadDigest });
        state(p, 'sealed');
        check();
        viewLength = p.viewLength as number;
        sealed = true;
        return viewLength;
      });
    },
    async read(consume: (text: string) => Promise<void>) {
      return exclusive(async () => {
        check();
        if (output === 'search' || !sealed || done || viewLength === undefined)
          throw new Error('Staged source read unavailable');
        const extent = expectedOutput?.length ?? viewLength;
        const p = await rpc('note.operation.read', {
          ...identity(),
          kind: header.output,
          ...(cursor === undefined ? {} : { cursor }),
          maxItems: 64,
          maxSourceBytes: readBytes,
          maxWireBytes: 8192,
        });
        envelope(p, 8192);
        if (
          p.kind !== 'noteOperationPage' ||
          p.headerDigest !== headerDigest ||
          p.payloadDigest !== payloadDigest ||
          p.outputKind !== header.output ||
          p.sourceLength !== viewLength ||
          p.expiresAt !== expiresAt ||
          !token(p.viewId) ||
          (viewId !== undefined && p.viewId !== viewId) ||
          !Array.isArray(p.items) ||
          p.items.length > 64 ||
          (p.nextCursor !== null && (!token(p.nextCursor) || p.nextCursor === cursor))
        )
          throw new Error('Mismatched staged source page');
        let next = offset,
          textBytes = 0;
        const items = p.items.map((value) => {
          const item = record(value);
          if (item.offset !== next || !validStageText(item.text))
            throw new Error('Invalid staged source prefix');
          if (
            expectedOutput !== undefined &&
            item.text !== expectedOutput.slice(next, next + item.text.length)
          )
            throw new Error('Selection output differs from native serializer');
          next += item.text.length;
          textBytes += size(item.text);
          if (!uint(next) || next > extent || textBytes > readBytes)
            throw new Error('Staged source page exceeded');
          return item.text;
        });
        if (
          (p.nextCursor === null && next !== extent) ||
          (p.nextCursor !== null && next === offset)
        )
          throw new Error('Incomplete staged source prefix');
        check();
        // Capture all validated selectors before invoking an asynchronous sink.
        const nextCursor = p.nextCursor as string | null,
          nextView = p.viewId;
        for (const text of items) {
          await consume(text);
          check();
        }
        offset = next;
        viewId = nextView;
        done = nextCursor === null;
        cursor = nextCursor ?? undefined;
        return done;
      });
    },
    /** Search and reached detail resources share the original sealed view. This
     * validates bounded envelopes only; the native consumer validates item meaning.
     * JSON bounds apply after transport decode, not to its predecode allocation. */
    async readRendered(request: {
      kind: 'search' | 'detail';
      ref?: string;
      cursor?: string;
    }): Promise<NoteRenderedOperationPage> {
      return exclusive(async () => {
        check();
        const { kind, ref, cursor: requestedCursor } = request;
        if (
          output !== 'search' ||
          !sealed ||
          viewLength === undefined ||
          !['search', 'detail'].includes(kind) ||
          (kind === 'detail' ? !token(ref) : ref !== undefined) ||
          (requestedCursor !== undefined && !token(requestedCursor))
        )
          throw new Error('Invalid rendered search read');
        const p = await rpc('note.operation.read', {
          ...identity(),
          kind,
          ...(ref === undefined ? {} : { ref }),
          ...(requestedCursor === undefined ? {} : { cursor: requestedCursor }),
          maxItems: 16,
          maxSourceBytes: 1024,
          maxWireBytes: 8192,
        });
        envelope(p, 8192);
        if (
          p.kind !== 'noteOperationPage' ||
          p.outputKind !== kind ||
          p.headerDigest !== headerDigest ||
          p.payloadDigest !== payloadDigest ||
          p.sourceLength !== viewLength ||
          p.expiresAt !== expiresAt ||
          !token(p.viewId) ||
          (viewId !== undefined && p.viewId !== viewId) ||
          'beforeRevision' in p ||
          'afterRevision' in p ||
          !Array.isArray(p.items) ||
          p.items.length > 16 ||
          (p.nextCursor !== null && (!token(p.nextCursor) || p.nextCursor === requestedCursor))
        )
          throw new Error('Mismatched rendered search page');
        check();
        viewId = p.viewId;
        // Snapshot the bounded decoded JSON before any downstream callbacks/awaits.
        return JSON.parse(
          JSON.stringify({
            items: p.items,
            nextCursor: p.nextCursor,
            ...(kind === 'search' ? { scannedThrough: p.scannedThrough, count: p.count } : {}),
          }),
        ) as NoteRenderedOperationPage;
      });
    },
    async cancel() {
      return exclusive(async () => {
        if (!begun || cancelled) return;
        cancelled = true;
        const p = await rpc('note.operation.cancel', identity(), true);
        state(p, 'cancelled');
      });
    },
  };
}
export type NoteSourceOperation = ReturnType<typeof createNoteSourceOperation>;
