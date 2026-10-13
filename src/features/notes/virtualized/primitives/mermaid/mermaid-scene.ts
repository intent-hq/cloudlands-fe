/** Lossless native scene storage records. Geometry is an observation, not a safe
 * paint/culling bound: filters, markers, CSS and foreignObject can overflow it.
 * Consumers must use a prepared viewport artifact rather than rebuild the full SVG.
 */
export type MermaidSceneRecord =
  | {
      kind: 'node';
      id: number;
      parent: number | null;
      nodeType: number;
      name: string;
      namespace: string | null;
    }
  | {
      kind: 'attribute';
      node: number;
      index: number;
      field: 'name' | 'namespace' | 'value';
      offset: number;
      text: string;
      done: boolean;
    }
  | { kind: 'text'; node: number; offset: number; text: string; done: boolean }
  | {
      kind: 'geometry';
      node: number;
      box: [number, number, number, number];
      matrix: [number, number, number, number, number, number];
    };
export interface MermaidSceneSink {
  signal: AbortSignal;
  append(record: string): Promise<void>;
}

const CHUNK_UNITS = 1024;
function* fragments(value: string) {
  let offset = 0;
  do {
    let end = Math.min(value.length, offset + CHUNK_UNITS);
    // Never split a Unicode pair across independently UTF-8 encoded records.
    if (end < value.length) {
      const last = value.charCodeAt(end - 1),
        next = value.charCodeAt(end);
      if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
    }
    yield { offset, text: value.slice(offset, end), done: end === value.length };
    offset = end;
  } while (offset < value.length);
}

/** Runs only inside the isolated native construction context. TreeWalker avoids
 * retaining a second scene tree; the WeakMap labels actual native node identity.
 * Full source/native DOM/renderer serialization costs belong to the producer job.
 */
export async function streamMermaidScene(svg: SVGSVGElement, sink: MermaidSceneSink) {
  let nodes = 0,
    records = 0,
    outputBytes = 0,
    maxRecordBytes = 0;
  const ids = new WeakMap<Node, number>();
  const emit = async (record: MermaidSceneRecord) => {
    sink.signal.throwIfAborted();
    const encoded = JSON.stringify(record);
    const bytes = new TextEncoder().encode(encoded).length;
    if (bytes > 16384) throw new Error('Native Mermaid scene record exceeds host budget');
    await sink.append(encoded);
    sink.signal.throwIfAborted();
    records++;
    outputBytes += bytes;
    maxRecordBytes = Math.max(maxRecordBytes, bytes);
  };
  const walker = svg.ownerDocument.createTreeWalker(svg);
  let node: Node | null = walker.currentNode;
  while (node) {
    sink.signal.throwIfAborted();
    const id = nodes++;
    ids.set(node, id);
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : undefined;
    if (node.nodeName.length > CHUNK_UNITS || (element?.namespaceURI?.length ?? 0) > CHUNK_UNITS)
      throw new Error('Native Mermaid node name exceeds profile');
    await emit({
      kind: 'node',
      id,
      parent: node === svg ? null : (ids.get(node.parentNode!) ?? null),
      nodeType: node.nodeType,
      name: node.nodeName,
      namespace: element?.namespaceURI ?? null,
    });
    if (element) {
      for (let index = 0; index < element.attributes.length; index++) {
        const attribute = element.attributes[index];
        for (const field of ['name', 'namespace', 'value'] as const) {
          const value = field === 'namespace' ? (attribute.namespaceURI ?? '') : attribute[field];
          for (const part of fragments(value))
            await emit({ kind: 'attribute', node: id, index, field, ...part });
        }
      }
      const graphics = element as SVGGraphicsElement;
      if (typeof graphics.getBBox === 'function' && typeof graphics.getCTM === 'function') {
        // Non-rendered definitions can have no CTM or throw for geometry. Native
        // names/attributes remain lossless even when there is no geometry record.
        let geometry: Extract<MermaidSceneRecord, { kind: 'geometry' }> | undefined;
        try {
          const box = graphics.getBBox(),
            matrix = graphics.getCTM();
          if (matrix) {
            const values = [
              box.x,
              box.y,
              box.width,
              box.height,
              matrix.a,
              matrix.b,
              matrix.c,
              matrix.d,
              matrix.e,
              matrix.f,
            ];
            if (values.every(Number.isFinite))
              geometry = {
                kind: 'geometry',
                node: id,
                box: [box.x, box.y, box.width, box.height],
                matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
              };
          }
        } catch {
          // A missing native bbox is not proof of an empty painted region.
        }
        if (geometry) await emit(geometry);
      }
    } else if (node.nodeValue !== null) {
      for (const part of fragments(node.nodeValue)) await emit({ kind: 'text', node: id, ...part });
    }
    node = walker.nextNode();
  }
  return { nodes, records, outputBytes, maxRecordBytes };
}
