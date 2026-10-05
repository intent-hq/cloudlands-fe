import type { NoteScope, NoteSplice, NoteSpliceOperation } from '$lib/client/note-pages';

/** An edit batch addresses the document after preceding batches, as native
 * transactions do. This is distinct from the wire's single-base splice array. */
export interface NoteEditBatch {
  splices: readonly NoteSplice[];
}
type Piece = { base: number; length: number } | { text: string };
const length = (piece: Piece) => ('base' in piece ? piece.length : piece.text.length);
const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).byteLength;
const offset = (n: number) => Number.isSafeInteger(n) && n >= 0;
const wellFormed = (text: string) => {
  for (const scalar of text) {
    const code = scalar.charCodeAt(0);
    if (scalar.length === 1 && code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
};
const scalarText = (text: string) => !text.includes('\0') && wellFormed(text);
const boundary = (text: string, at: number) =>
  at === 0 ||
  at === text.length ||
  !(
    text.charCodeAt(at - 1) >= 0xd800 &&
    text.charCodeAt(at - 1) <= 0xdbff &&
    text.charCodeAt(at) >= 0xdc00 &&
    text.charCodeAt(at) <= 0xdfff
  );

function validateSplices(sourceLength: number, splices: readonly NoteSplice[]) {
  let previous: NoteSplice | undefined;
  for (const splice of splices) {
    if (
      !offset(splice.start) ||
      !offset(splice.end) ||
      splice.end < splice.start ||
      splice.end > sourceLength ||
      !scalarText(splice.text) ||
      (previous && (previous.end > splice.start || previous.start >= splice.start))
    )
      throw new Error('Invalid note edit range or text');
    previous = splice;
  }
}

/** Uses only source coordinates and inserted text. Never reads or copies an
 * untouched source span. The document owner must validate base endpoints against
 * its scalar-safe source mapping; those bytes are intentionally unavailable here. */
export function composeNoteEdits(
  sourceLength: number,
  batches: readonly NoteEditBatch[],
): NoteSplice[] {
  if (!offset(sourceLength)) throw new Error('Invalid note source length');
  let pieces: Piece[] = sourceLength ? [{ base: 0, length: sourceLength }] : [];
  let currentLength = sourceLength;
  const slice = (start: number, end: number): Piece[] => {
    const result: Piece[] = [];
    let at = 0;
    for (const piece of pieces) {
      const size = length(piece);
      const from = Math.max(start - at, 0);
      const to = Math.min(end - at, size);
      if (from < to) {
        if ('base' in piece) result.push({ base: piece.base + from, length: to - from });
        else {
          if (!boundary(piece.text, from) || !boundary(piece.text, to))
            throw new Error('Note edit splits an inserted Unicode scalar');
          result.push({ text: piece.text.slice(from, to) });
        }
      }
      at += size;
      if (at >= end) break;
    }
    return result;
  };
  for (const batch of batches) {
    validateSplices(currentLength, batch.splices);
    // Native transaction batches have one coordinate base. Applying right to
    // left prevents an earlier insertion from shifting a later edit's address.
    for (let i = batch.splices.length - 1; i >= 0; i--) {
      const splice = batch.splices[i];
      const nextLength = currentLength - (splice.end - splice.start) + splice.text.length;
      if (!offset(nextLength)) throw new Error('Note source length overflow');
      pieces = [
        ...slice(0, splice.start),
        ...(splice.text ? [{ text: splice.text }] : []),
        ...slice(splice.end, currentLength),
      ];
      currentLength = nextLength;
    }
  }
  const result: NoteSplice[] = [];
  let base = 0;
  let inserted = '';
  const emit = (end: number) => {
    if (end !== base || inserted) result.push({ start: base, end, text: inserted });
    inserted = '';
  };
  for (const piece of pieces) {
    if ('text' in piece) inserted += piece.text;
    else {
      emit(piece.base);
      base = piece.base + piece.length;
    }
  }
  emit(sourceLength);
  return result;
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Invalid canonical note payload');
  return encoded;
};

/** Hash the exact inline wire payload, including the original operation deadline.
 * Receipt verification may outlive that deadline; this computes identity only
 * and does not authorize a new write or renew an operation. Caller bounds input. */
export async function noteSavePayloadDigest(operation: Omit<NoteSpliceOperation, 'payloadDigest'>) {
  const { scope, baseRevision, operationId, expiresAt, splices } = operation;
  const encoded = encoder.encode(
    canonical({
      method: 'note.applySplices',
      ...scope,
      baseRevision,
      operationId,
      expiresAt,
      splices,
    }),
  );
  if (encoded.byteLength > 65_536) throw new Error('Oversized note save payload');
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}

export interface NoteSaveInput {
  scope: NoteScope;
  sourceLength: number;
  baseRevision: string;
  operationId: string;
  expiresAt: string;
  splices: readonly NoteSplice[];
}

/** Capture one logical save before hashing. Caller mutation or later typing
 * cannot alter the operation whose exact identity must survive a lost ACK. */
export async function prepareNoteSave(
  input: NoteSaveInput,
  now = Date.now(),
): Promise<NoteSpliceOperation> {
  const scope = {
    backendId: input.scope.backendId,
    workspaceId: input.scope.workspaceId,
    noteId: input.scope.noteId,
    noteInstanceId: input.scope.noteInstanceId,
  };
  const { baseRevision, operationId, expiresAt, sourceLength } = input;
  const splices = input.splices.map(({ start, end, text }) => ({ start, end, text }));
  if (!offset(sourceLength)) throw new Error('Invalid note source length');
  for (const token of [
    scope.backendId,
    scope.workspaceId,
    scope.noteId,
    scope.noteInstanceId,
    baseRevision,
  ])
    if (!token || bytes(token) > 256 || !wellFormed(token))
      throw new Error('Invalid note save identity');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(operationId))
    throw new Error('Invalid note operation ID');
  const deadline = Date.parse(expiresAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(deadline) ||
    new Date(deadline).toISOString() !== expiresAt ||
    deadline <= now ||
    deadline - now > 86_400_000
  )
    throw new Error('Invalid note operation deadline');
  validateSplices(sourceLength, splices);
  if (
    !splices.length ||
    splices.length > 32 ||
    splices.reduce((sum, s) => sum + bytes(s.text), 0) > 16_384
  )
    throw new Error('Note edit requires a staged save');
  const payload = {
    method: 'note.applySplices',
    ...scope,
    baseRevision,
    operationId,
    expiresAt,
    splices,
  };
  // Reserve the largest legal escaped RPC ID before allocating the digest. The
  // transport still owns validation of its actual serialized frame and ID.
  const params = {
    ...scope,
    baseRevision,
    operationId,
    expiresAt,
    splices,
    payloadDigest: '0'.repeat(64),
  };
  if (
    bytes(JSON.stringify({ jsonrpc: '2.0', id: '\0'.repeat(64), method: payload.method, params })) >
    65_536
  )
    throw new Error('Note edit requires a staged save');
  const payloadDigest = await noteSavePayloadDigest({
    scope,
    baseRevision,
    operationId,
    expiresAt,
    splices,
  });
  for (const splice of splices) Object.freeze(splice);
  Object.freeze(splices);
  Object.freeze(scope);
  return Object.freeze({ scope, baseRevision, operationId, expiresAt, payloadDigest, splices });
}
