import type { NoteWindow } from './note-window-reader';
import type { NoteCanonicalResources } from './note-canonical-resources';
type Descriptor = NoteWindow['context'][number];
type Boundary = Extract<Descriptor, { kind: 'boundary' }>;
export interface NoteCanonicalOwner {
  ownerId: string;
  nativeRef: string;
  nativeId: string;
  sourceRange: Boundary['sourceRange'];
  construct: string;
  /** Source pieces remain opaque scoped handles, never interpreted as a hull. */
  htmlSource?: Boundary['htmlSource'];
}
/** Finalize a completely canonical HTML-table region only. Assembly descriptors
 * remain charged by DATA until the generator and original cached pages release.
 * Mixed Markdown/HTML windows keep their lexical context. Commands may resolve a
 * compact owner's original descriptor through its scoped occurrence binding. */
export function retainCanonicalRegion(
  context: Descriptor[],
  bindings: NoteWindow['mapBindings'],
  native: NoteCanonicalResources,
  range: NoteWindow['range'],
) {
  const byId = new Map(context.map((item) => [item.id, item]));
  const table = context.find((item) => {
    if (
      item.kind !== 'boundary' ||
      item.construct !== 'htmlTable' ||
      item.htmlSource?.provenance !== 'explicit' ||
      !item.nativeRef ||
      item.sourceRange.start > range.start ||
      item.sourceRange.end < range.end
    )
      return false;
    const ids = native.references[item.nativeRef];
    const node = ids?.length === 1 ? byId.get(ids[0]) : undefined;
    return (
      node?.kind === 'nativeNode' &&
      node.nodeType === 'table' &&
      node.provenance === 'explicit' &&
      node.sourceRange.start <= range.start &&
      node.sourceRange.end >= range.end &&
      bindings.some((binding) => binding.ownerId === item.id)
    );
  });
  if (!table) return { context, native, owners: undefined };
  const owners: NoteCanonicalOwner[] = [];
  for (const item of context) {
    if (item.kind !== 'boundary' || !item.nativeRef) continue;
    const ids = native.references[item.nativeRef];
    if (ids?.length !== 1 || byId.get(ids[0])?.kind !== 'nativeNode')
      throw new Error('Unresolved canonical owner association');
    owners.push({
      ownerId: item.id,
      nativeRef: item.nativeRef,
      nativeId: ids[0],
      sourceRange: item.sourceRange,
      construct: item.construct,
      ...(item.htmlSource ? { htmlSource: item.htmlSource } : {}),
    });
  }
  const retained = context.filter(
    (item) => item.kind === 'nativeNode' || item.kind === 'sourceMap',
  );
  const retainedIds = new Set(retained.map((item) => item.id));
  // An index entry denotes locally resolved descriptors. Opaque ownerRef and
  // sourcePiecesRef fields on retained descriptors are preserved unmodified.
  const references = Object.fromEntries(
    Object.entries(native.references).filter(([, ids]) => ids.every((id) => retainedIds.has(id))),
  );
  return { context: retained, native: { ...native, references }, owners };
}
