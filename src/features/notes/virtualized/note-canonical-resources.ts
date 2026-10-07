import type { NotePageRequest, NoteReadPage, SourceRange } from '$lib/client/note-pages';
type Item = Extract<NoteReadPage, { kind: 'noteContextPage' }>['items'][number];
type Descriptor = Exclude<Item, { kind: 'fragment' }>;
type Metadata = Extract<NoteReadPage, { kind: 'noteMetadataPage' }>['items'][number];
type Steps<T> = Generator<NotePageRequest, T, NoteReadPage>;
export interface NoteCanonicalResources {
  references: Record<string, string[]>;
  texts: Record<string, string>;
  attributes: Record<string, unknown>;
}
/** Resolves only references supplied by the admitted source windows. No note
 * metadata root, sibling native directory, or previous text window is traversed. */
export function* canonicalResources(
  context: Map<string, Descriptor>,
  bindings: Array<{
    ownerId: string;
    sourceMapRef: string;
    contextRef: string;
    range: SourceRange;
  }>,
  request: (q: NotePageRequest) => Steps<NoteReadPage>,
  charge: (item: unknown) => void,
  existing?: NoteCanonicalResources,
): Steps<NoteCanonicalResources> {
  const result: NoteCanonicalResources = existing ?? {
    references: Object.create(null),
    texts: Object.create(null),
    attributes: Object.create(null),
  };
  const resolving = new Set<string>();
  function* collection(ref: string, kind: 'context' | 'metadata'): Steps<Array<Item | Metadata>> {
    const items: Array<Item | Metadata> = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = yield* request(
        kind === 'context' ? { kind, contextRef: ref, cursor } : { kind, ref, cursor },
      );
      if (page.kind !== (kind === 'context' ? 'noteContextPage' : 'noteMetadataPage'))
        throw new Error('Invalid canonical resource kind');
      if (page.kind !== 'noteContextPage' && page.kind !== 'noteMetadataPage')
        throw new Error('Missing canonical collection');
      for (const item of page.items) {
        charge(item);
        items.push(item);
      }
      if (page.nextCursor && (cursors.has(page.nextCursor) || !page.items.length))
        throw new Error('Canonical resource made no progress');
      cursor = page.nextCursor ?? undefined;
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return items;
  }
  function* resolve(ref: string): Steps<Descriptor[]> {
    if (result.references[ref]) return result.references[ref].map((id) => context.get(id)!);
    if (resolving.has(ref)) throw new Error('Canonical reference cycle');
    resolving.add(ref);
    const items = yield* collection(ref, 'context');
    const descriptors: Descriptor[] = [];
    for (const item of items) {
      if (!('kind' in item) || item.kind === 'fragment')
        throw new Error('Expected canonical descriptor');
      const prior = context.get(item.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(item))
        throw new Error('Conflicting canonical identity');
      if (!prior) context.set(item.id, item);
      descriptors.push(item);
    }
    result.references[ref] = descriptors.map((d) => d.id);
    charge({ ref, ids: result.references[ref] });
    resolving.delete(ref);
    return descriptors;
  }
  function* fragment(ref: string, expected?: string): Steps<string> {
    if (Object.hasOwn(result.texts, ref)) return result.texts[ref];
    let next: string | null = ref,
      text = '',
      field = expected;
    const seen = new Set<string>();
    while (next) {
      if (seen.has(next)) throw new Error('Canonical text reference cycle');
      seen.add(next);
      const parts: Array<Item | Metadata> = yield* collection(next, 'context');
      if (!parts.length) throw new Error('Missing canonical text fragment');
      next = null;
      for (const item of parts) {
        if (
          !('kind' in item) ||
          item.kind !== 'fragment' ||
          item.offset !== text.length ||
          (field !== undefined && item.field !== field)
        )
          throw new Error('Noncontiguous canonical text fragment');
        field = item.field;
        text += item.text;
        next = item.nextRef;
        if (!item.text && next) throw new Error('Canonical text made no progress');
      }
    }
    charge({ ref, text });
    result.texts[ref] = text;
    return text;
  }
  function* value(item: Metadata): Steps<unknown> {
    if (item.type === 'string') return item.valueRef ? yield* fragment(item.valueRef) : item.value;
    if (item.type !== 'object' && item.type !== 'array') return item.value;
    const children = yield* collection(item.childrenRef!, 'metadata');
    const output: Record<string, unknown> | unknown[] =
      item.type === 'array' ? [] : Object.create(null);
    for (const child of children) {
      if ('kind' in child || child.parentId !== item.id)
        throw new Error('Invalid canonical attribute parent');
      // Effective schema attribute keys are bounded names. Do not drain arbitrary
      // giant raw attribute keys to discover whether the native schema uses them.
      if (child.keyRef)
        throw new Error('Canonical schema attribute key requires a bounded selector');
      if (Array.isArray(output)) {
        if (child.index !== output.length)
          throw new Error('Noncontiguous canonical attribute array');
        output.push(yield* value(child));
      } else {
        if (child.key === undefined || Object.hasOwn(output, child.key))
          throw new Error('Invalid canonical attribute key');
        output[child.key] = yield* value(child);
      }
    }
    return output;
  }
  function* attributes(ref: string): Steps<void> {
    if (Object.hasOwn(result.attributes, ref)) return;
    if (resolving.has(ref)) throw new Error('Canonical attribute cycle');
    resolving.add(ref);
    const roots = yield* collection(ref, 'metadata');
    if (roots.length !== 1 || 'kind' in roots[0] || roots[0].parentId !== null)
      throw new Error('Missing canonical attribute root');
    result.attributes[ref] = yield* value(roots[0]);
    charge({ ref, value: result.attributes[ref] });
    resolving.delete(ref);
  }
  // A table's window map already indexes all visible descendant text. Keep every
  // occurrence/binding on the window, but do not fetch equivalent row/cell maps.
  // Match the explicit table owner and issuing window, not raw overlap alone:
  // repaired/implicit native ancestry remains resolved through direct references.
  const requiredBindings = bindings.filter((binding) => {
    const owner = context.get(binding.ownerId);
    if (owner?.kind !== 'boundary' || !['htmlTableRow', 'htmlTableCell'].includes(owner.construct))
      return true;
    return !bindings.some((candidate) => {
      if (
        candidate.contextRef !== binding.contextRef ||
        candidate.range.start !== binding.range.start ||
        candidate.range.end !== binding.range.end
      )
        return false;
      const table = context.get(candidate.ownerId);
      return (
        table?.kind === 'boundary' &&
        table.construct === 'htmlTable' &&
        table.htmlPosition?.tableRef !== undefined &&
        table.htmlPosition.tableRef === owner.htmlPosition?.tableRef
      );
    });
  });
  for (const binding of requiredBindings) {
    const maps = yield* resolve(binding.sourceMapRef);
    const owner = context.get(binding.ownerId);
    const markdownDocument = owner?.kind === 'boundary' && owner.construct === 'markdownDocument';
    if (markdownDocument && !maps.length && binding.range.start !== binding.range.end)
      throw new Error('Canonical Markdown document window mapping missing');
    for (const map of maps) {
      if (map.kind !== 'sourceMap') throw new Error('Expected canonical source mapping');
      const owners = yield* resolve(map.ownerRef);
      if (owners.length !== 1 || owners[0].id !== binding.ownerId)
        throw new Error('Canonical mapping owner mismatch');
      if (
        markdownDocument &&
        (map.mapping !== 'omitted' ||
          map.sourceRange.start >= map.sourceRange.end ||
          map.sourceRange.start < binding.range.start ||
          map.sourceRange.end > binding.range.end ||
          map.renderedRange.start !== 0 ||
          map.renderedRange.end !== 0 ||
          map.textRef !== null ||
          map.textNodeId !== null ||
          map.textNodeRef !== null)
      )
        throw new Error('Canonical Markdown document mapping mismatch');
      if (map.textRef) {
        const text = yield* fragment(map.textRef, 'renderedText');
        if (text.length !== map.renderedRange.end - map.renderedRange.start)
          throw new Error('Canonical text length mismatch');
      }
      if (map.textNodeRef) {
        const nodes = yield* resolve(map.textNodeRef);
        if (nodes.length !== 1 || nodes[0].kind !== 'nativeNode' || nodes[0].id !== map.textNodeId)
          throw new Error('Canonical text ownership mismatch');
      }
    }
  }
  // Map iteration visits newly resolved ancestors, but never expands descendants.
  for (const item of context.values()) {
    if ('nativeRef' in item && item.nativeRef) {
      const nodes = yield* resolve(item.nativeRef);
      if (nodes.length !== 1 || nodes[0].kind !== 'nativeNode')
        throw new Error('Invalid canonical native owner');
      if (item.kind === 'boundary' && item.construct === 'markdownBlock') {
        const block = nodes[0];
        if (
          !['paragraph', 'heading'].includes(block.nodeType) ||
          block.nodeClass !== 'container' ||
          block.parentRef === null ||
          block.sourceRange.start !== item.sourceRange.start ||
          block.sourceRange.end !== item.sourceRange.end ||
          block.attributesRef !== item.attributesRef ||
          block.profile !== item.profile ||
          block.profileVersion !== item.profileVersion
        )
          throw new Error('Canonical Markdown block owner mismatch');
      }
      if (
        item.kind === 'boundary' &&
        ['htmlDocument', 'markdownDocument'].includes(item.construct)
      ) {
        const root = nodes[0];
        if (
          root.nodeType !== 'doc' ||
          root.nodeClass !== 'container' ||
          root.parentRef !== null ||
          root.childIndex !== 0 ||
          root.attributesRef !== item.attributesRef ||
          root.profile !== item.profile ||
          root.profileVersion !== item.profileVersion
        )
          throw new Error('Canonical document root mismatch');
      }
    }
    if (item.kind !== 'nativeNode') continue;
    if (item.parentRef) {
      const parents = yield* resolve(item.parentRef);
      if (parents.length !== 1 || parents[0].kind !== 'nativeNode')
        throw new Error('Invalid canonical native parent');
    }
    yield* attributes(item.attributesRef);
    if (item.marksRef) yield* attributes(item.marksRef);
  }
  return result;
}
