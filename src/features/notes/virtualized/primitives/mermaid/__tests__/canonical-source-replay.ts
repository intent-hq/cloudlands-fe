import type { NotePageRequest, NoteReadPage, NoteScope } from '$lib/client/note-pages';

type ContextPage = Extract<NoteReadPage, { kind: 'noteContextPage' }>;
type MetadataPage = Extract<NoteReadPage, { kind: 'noteMetadataPage' }>;
export interface CapturedMermaidOwner {
  scope: NoteScope;
  snapshotId: string;
  sourceRevision: string;
  expiresAt: string;
  ownerRef: string;
  nativeId: string;
}

/** TEST ONLY replay of already validated Store pages. This checks the visible
 * binding, not signed-token authenticity, principal authority or a runtime grant.
 * The caller owns transport reservations and supplies NotePageReader validation.
 * No note-source reads, parser, decoder or concatenated code value is used here. */
export async function resolveCapturedMermaidSource(
  owner: CapturedMermaidOwner,
  read: (request: NotePageRequest) => Promise<NoteReadPage>,
  lifetime: { signal: AbortSignal; isCurrent: () => boolean; now: () => number },
  limits = { requests: 64, wireBytes: 262144, sourceBytes: 131072 },
) {
  const pinned = Object.freeze({ ...owner, scope: Object.freeze({ ...owner.scope }) });
  const cost = { requests: 0, wireBytes: 0, sourceBytes: 0 };
  const encoder = new TextEncoder();
  function current() {
    lifetime.signal.throwIfAborted();
    if (!lifetime.isCurrent() || Date.parse(pinned.expiresAt) <= lifetime.now())
      throw new Error('Stale captured Mermaid source');
  }
  async function page(request: NotePageRequest) {
    current();
    if (++cost.requests > limits.requests) throw new Error('Captured source request limit');
    const response = await read({ ...request, maxWireBytes: 8192, maxItems: 1 });
    current();
    if (response.kind !== 'noteContextPage' && response.kind !== 'noteMetadataPage')
      throw new Error('Unexpected captured resource');
    if (
      response.kind !== (request.kind === 'context' ? 'noteContextPage' : 'noteMetadataPage') ||
      response.snapshotId !== pinned.snapshotId ||
      response.sourceRevision !== pinned.sourceRevision ||
      response.expiresAt !== pinned.expiresAt ||
      (Object.keys(pinned.scope) as Array<keyof NoteScope>).some(
        (key) => response.scope[key] !== pinned.scope[key],
      )
    )
      throw new Error('Mismatched captured source identity');
    // Serialized counters supplement the transport's preallocation reservation;
    // they are not an admission or physical-memory implementation.
    cost.wireBytes += encoder.encode(JSON.stringify(response)).length;
    if (cost.wireBytes > limits.wireBytes) throw new Error('Captured source wire limit');
    return response;
  }
  async function* collection(request: NotePageRequest) {
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = await page({ ...request, cursor } as NotePageRequest);
      yield response;
      if (response.nextCursor && (!response.items.length || seen.has(response.nextCursor)))
        throw new Error('Captured collection made no progress');
      cursor = response.nextCursor ?? undefined;
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  const direct = (await page({ kind: 'context', contextRef: pinned.ownerRef })) as ContextPage;
  const atom = direct.items[0];
  if (
    direct.nextCursor !== null ||
    direct.items.length !== 1 ||
    atom?.kind !== 'nativeNode' ||
    atom.id !== pinned.nativeId ||
    atom.nodeType !== 'mermaidBlock' ||
    atom.nodeClass !== 'atom' ||
    atom.profile !== 'canonicalNote' ||
    atom.profileVersion !== 1
  )
    throw new Error('Captured owner is not the selected canonical Mermaid atom');
  const rootPage = (await page({ kind: 'metadata', ref: atom.attributesRef })) as MetadataPage;
  const root = rootPage.items[0];
  if (
    rootPage.nextCursor !== null ||
    rootPage.items.length !== 1 ||
    root?.parentId !== null ||
    root.type !== 'object' ||
    !root.childrenRef
  )
    throw new Error('Invalid captured attributes root');
  let sourceRef: string | undefined;
  for await (const response of collection({ kind: 'metadata', ref: root.childrenRef })) {
    for (const field of (response as MetadataPage).items) {
      if (field.parentId !== root.id || field.keyRef)
        throw new Error('Invalid captured attribute ownership');
      if (field.key !== 'code') continue;
      if (sourceRef !== undefined || field.type !== 'string' || !field.valueRef)
        throw new Error('Missing or ambiguous exact code valueRef');
      sourceRef = field.valueRef;
    }
  }
  if (!sourceRef) throw new Error('Missing exact canonical code valueRef');
  const binding = Object.freeze({
    ...pinned,
    attributesRef: atom.attributesRef,
    sourceRef,
    primitive: 'mermaid' as const,
    evidence: 'captured-source-binding-only' as const,
  });
  let opened = false;
  async function* fragments() {
    if (opened) throw new Error('Captured source stream already opened');
    opened = true;
    let next: string | null = binding.sourceRef;
    let offset = 0;
    const seen = new Set<string>();
    while (next) {
      if (seen.has(next)) throw new Error('Captured fragment reference cycle');
      seen.add(next);
      const response = (await page({ kind: 'context', contextRef: next })) as ContextPage;
      const fragment = response.items[0];
      // Store emits both a cursor and nextRef for fragment continuation. Follow
      // the direct nextRef exactly once; do not also drain the equivalent cursor.
      if (
        response.items.length !== 1 ||
        fragment?.kind !== 'fragment' ||
        fragment.field !== 'value' ||
        fragment.offset !== offset ||
        (response.nextCursor === null) !== (fragment.nextRef === null) ||
        (!fragment.text && fragment.nextRef)
      )
        throw new Error('Invalid captured code fragment continuation');
      cost.sourceBytes += encoder.encode(fragment.text).length;
      if (cost.sourceBytes > limits.sourceBytes) throw new Error('Captured source byte limit');
      offset += fragment.text.length;
      next = fragment.nextRef;
      current();
      yield fragment.text;
    }
    current();
  }
  return { binding, fragments, inspect: () => ({ ...cost }) };
}
