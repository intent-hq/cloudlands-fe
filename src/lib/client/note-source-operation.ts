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
export interface NoteStageTextReference {
  textId: string;
  length: number;
  utf8Bytes: number;
  sha256: string;
}
export type NoteSourceStageRecord =
  | { kind: 'text'; id: string; offset: number; text: string }
  | {
      kind: 'splice';
      localSequence: number;
      ordinal: number;
      start: number;
      end: number;
      replacement: NoteStageTextReference;
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
  const scope = Object.freeze({
    backendId: input.scope.backendId,
    workspaceId: input.scope.workspaceId,
    noteId: input.scope.noteId,
    noteInstanceId: input.scope.noteInstanceId,
  });
  const h = input.header;
  if (h.action !== 'read' || h.output !== 'source' || h.selection !== 'all' || 'query' in h)
    throw new Error('Unsupported staged output');
  const header = Object.freeze({
    baseRevision: h.baseRevision,
    editorSessionId: h.editorSessionId,
    localEditSequence: h.localEditSequence,
    liveGeneration: h.liveGeneration,
    selectionGeneration: h.selectionGeneration,
    action: h.action,
    output: h.output,
    selection: h.selection,
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
    async append(stream: 'text' | 'dirty', original: readonly NoteSourceStageRecord[]) {
      return exclusive(async () => {
        check();
        if (
          !begun ||
          sealed ||
          !['text', 'dirty'].includes(stream) ||
          original.length < 1 ||
          original.length > 128
        )
          throw new Error('Invalid staged append');
        let textBytes = 0;
        const records = original.map((r) => {
          if (stream === 'text' && r.kind === 'text') {
            if (!token(r.id) || !uint(r.offset) || !validStageText(r.text) || r.text.length > 16384)
              throw new Error('Invalid staged text');
            textBytes += size(r.text);
            return { kind: r.kind, id: r.id, offset: r.offset, text: r.text };
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
        const m = manifest[stream === 'text' ? 0 : 1];
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
        if (!sealed || done || viewLength === undefined)
          throw new Error('Staged source read unavailable');
        const extent = viewLength;
        const p = await rpc('note.operation.read', {
          ...identity(),
          kind: 'source',
          ...(cursor === undefined ? {} : { cursor }),
          maxItems: 64,
          maxSourceBytes: 4096,
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
          next += item.text.length;
          textBytes += size(item.text);
          if (!uint(next) || next > extent || textBytes > 4096)
            throw new Error('Staged source page exceeded');
          return item.text;
        });
        if (
          (p.nextCursor === null && next !== viewLength) ||
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
