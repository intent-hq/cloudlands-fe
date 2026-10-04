import type { JSONContent } from '@tiptap/core';
import type { NoteWindow } from './note-window-reader';
import { SourceProjection } from './projection/source-projection';
type Descriptor = NoteWindow['context'][number];
type Native = Extract<Descriptor, { kind: 'nativeNode' }>;
type Mapping = Extract<Descriptor, { kind: 'sourceMap' }>;
type Segment = {
  sourceStart: number;
  sourceEnd: number;
  pmStart: number;
  pmEnd: number;
  identity: boolean;
};
/** Builds only the indexed canonical nodes admitted by a source window. The
 * immutable leaf ordinals are not confused with disposable view positions. */
export class NoteCanonicalProjection extends SourceProjection {
  private readonly segments: Segment[] = [];
  /** Snapshot identities and logical child ordinals remain distinct from the
   * mounted editor positions used by selection and document-operation adapters. */
  readonly nativeEntries: Array<{
    id: string;
    parentRef: string | null;
    childIndex: number;
    nodeType: string;
    from: number;
    to: number;
    sourceRange: Native['sourceRange'];
  }> = [];
  constructor(window: NoteWindow) {
    super(window.text, window.range.start, {
      revision: 0,
      from: window.range.start,
      to: window.range.end,
      before: [],
      after: [],
      canonical: true,
    });
    const resources = window.native;
    if (!resources) throw new Error('Missing canonical note resources');
    const allMaps = window.context.filter((m): m is Mapping => m.kind === 'sourceMap');
    let covered = window.range.start;
    for (const map of [...allMaps].sort((a, b) => a.sourceRange.start - b.sourceRange.start)) {
      if (map.sourceRange.start > covered) break;
      covered = Math.max(covered, map.sourceRange.end);
      if (
        map.mapping === 'identity' &&
        map.sourceRange.start >= window.range.start &&
        map.sourceRange.end <= window.range.end &&
        resources.texts[map.textRef!] !==
          window.text.slice(
            map.sourceRange.start - window.range.start,
            map.sourceRange.end - window.range.start,
          )
      )
        throw new Error('Canonical identity text differs from source');
    }
    if (covered < window.range.end) throw new Error('Canonical mapping coverage is incomplete');
    const nodes = window.context.filter((n): n is Native => n.kind === 'nativeNode');
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const children = new Map<string, Native[]>();
    const roots: Native[] = [];
    for (const n of nodes) {
      if (n.parentRef === null) {
        roots.push(n);
        continue;
      }
      const ids = resources.references[n.parentRef];
      if (ids?.length !== 1 || !byId.has(ids[0])) throw new Error('Missing canonical parent');
      const siblings = children.get(ids[0]) ?? [];
      if (siblings.some((s) => s.childIndex === n.childIndex))
        throw new Error('Conflicting canonical child order');
      siblings.push(n);
      children.set(ids[0], siblings);
    }
    if (roots.length !== 1 || roots[0].nodeType !== 'doc')
      throw new Error('Missing canonical root');
    const maps = window.context.filter(
      (m): m is Mapping => m.kind === 'sourceMap' && m.mapping !== 'omitted',
    );
    const seen = new Set<string>();
    const localMaps = new Map<JSONContent, Array<{ map: Mapping; start: number; end: number }>>();
    const sourceNodes = new Map<JSONContent, Native>();
    const build = (n: Native): JSONContent | null => {
      if (seen.has(n.id)) throw new Error('Canonical ancestry cycle');
      seen.add(n.id);
      if (n.nodeClass === 'text') {
        const parts = maps
          .filter((m) => m.textNodeId === n.id)
          .sort((a, b) => a.renderedRange.start - b.renderedRange.start);
        let text = '';
        const offsets: Array<{ map: Mapping; start: number; end: number }> = [];
        for (const map of parts) {
          const value = map.textRef ? resources.texts[map.textRef] : undefined;
          if (value === undefined) throw new Error('Missing canonical rendered text');
          const previous = offsets.at(-1)?.map;
          if (previous && map.renderedRange.start < previous.renderedRange.end) {
            if (
              map.renderedRange.start === previous.renderedRange.start &&
              map.renderedRange.end === previous.renderedRange.end &&
              map.sourceRange.start === previous.sourceRange.start &&
              map.sourceRange.end === previous.sourceRange.end &&
              value === resources.texts[previous.textRef!]
            )
              continue;
            throw new Error('Conflicting canonical leaf maps');
          }
          offsets.push({ map, start: text.length, end: text.length + value.length });
          text += value;
        }
        if (!text) return null;
        const marks = n.marksRef ? resources.attributes[n.marksRef] : undefined;
        if (marks !== undefined && !Array.isArray(marks))
          throw new Error('Invalid canonical mark array');
        const leaf: JSONContent = {
          type: 'text',
          text,
          ...(marks ? { marks: marks as JSONContent['marks'] } : {}),
        };
        localMaps.set(leaf, offsets);
        sourceNodes.set(leaf, n);
        return leaf;
      }
      const attrs = resources.attributes[n.attributesRef];
      if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs))
        throw new Error('Invalid canonical node attributes');
      const content = (children.get(n.id) ?? [])
        .sort((a, b) => a.childIndex - b.childIndex)
        .map(build)
        .filter((n): n is JSONContent => n !== null);
      if (n.nodeClass === 'atom' && content.length)
        throw new Error('Canonical atom has native children');
      const result: JSONContent = {
        type: n.nodeType,
        ...(n.nodeType === 'doc' ? {} : { attrs }),
        ...(n.nodeClass === 'atom' ? {} : { content }),
      };
      sourceNodes.set(result, n);
      return result;
    };
    const root = build(roots[0])!;
    if (seen.size !== nodes.length) throw new Error('Disconnected canonical ancestry');
    const record = (node: JSONContent, pos: number): number => {
      const origin = sourceNodes.get(node)!;
      const entry = {
        id: origin.id,
        parentRef: origin.parentRef,
        childIndex: origin.childIndex,
        nodeType: origin.nodeType,
        from: pos,
        to: pos,
        sourceRange: origin.sourceRange,
      };
      this.nativeEntries.push(entry);
      if (node.type === 'text') {
        for (const part of localMaps.get(node) ?? []) {
          const segment = {
            sourceStart: part.map.sourceRange.start,
            sourceEnd: part.map.sourceRange.end,
            pmStart: pos + part.start,
            pmEnd: pos + part.end,
            identity: part.map.mapping === 'identity',
          };
          this.segments.push(segment);
          this.positions.set(segment.pmStart, segment.sourceStart);
          this.ends.set(segment.pmEnd, segment.sourceEnd);
          this.positions.set(segment.pmEnd, segment.sourceEnd);
          if (segment.identity)
            for (let i = 0; i <= part.end - part.start; i++)
              this.positions.set(segment.pmStart + i, segment.sourceStart + i);
        }
        entry.to = pos + node.text!.length;
        return node.text!.length;
      }
      if (origin.nodeClass === 'atom') {
        this.positions.set(pos, origin.sourceRange.start);
        this.positions.set(pos + 1, origin.sourceRange.end);
        entry.to = pos + 1;
        return 1;
      }
      let size = 0;
      const inner = pos + (node.type === 'doc' ? 0 : 1);
      for (const child of node.content ?? []) size += record(child, inner + size);
      entry.to = pos + size + (node.type === 'doc' ? 0 : 2);
      return size + (node.type === 'doc' ? 0 : 2);
    };
    record(root, 0);
    Object.assign(this.content, root);
  }
  override pmAt(source: number, affinity = 1) {
    const segment = this.segments.find((s) => source >= s.sourceStart && source <= s.sourceEnd);
    if (segment) {
      if (source === segment.sourceStart) return segment.pmStart;
      if (source === segment.sourceEnd) return segment.pmEnd;
      return segment.identity
        ? segment.pmStart + source - segment.sourceStart
        : affinity < 0
          ? segment.pmStart
          : segment.pmEnd;
    }
    return super.pmAt(source, affinity);
  }
  override sourceAt(pm: number, affinity = 1) {
    const segment = this.segments.find((s) => pm > s.pmStart && pm < s.pmEnd);
    if (segment && !segment.identity) return affinity < 0 ? segment.sourceStart : segment.sourceEnd;
    return super.sourceAt(pm, affinity);
  }
}
