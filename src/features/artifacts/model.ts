import {
  ArtifactBlockSchema,
  ArtifactDocumentSchema,
  ArtifactSelectionSchema,
} from '$shared/types/visual-artifact';
import type {
  ArtifactBlock,
  ArtifactDocument,
  ArtifactSelection,
  ArtifactSelectionSnapshot,
} from '$shared/types/visual-artifact';

export const MAX_ARTIFACT_BYTES = 1_048_576;

/** Bound nesting before recursive schema validation, including adversarial agent output. */
export function isBoundedJson(value: unknown, maxBytes = MAX_ARTIFACT_BYTES): boolean {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const next = stack.pop();
    if (!next) break;
    if (++nodes > 20000 || next.depth > 24) return false;
    if (next.value && typeof next.value === 'object') {
      if (
        !Array.isArray(next.value) &&
        Object.getPrototypeOf(next.value) !== Object.prototype &&
        Object.getPrototypeOf(next.value) !== null
      )
        return false;
      for (const item of Object.values(next.value))
        stack.push({ value: item, depth: next.depth + 1 });
    } else if (next.value !== null && !['string', 'boolean', 'number'].includes(typeof next.value))
      return false;
    else if (typeof next.value === 'number' && !Number.isFinite(next.value)) return false;
  }
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= maxBytes;
  } catch {
    return false;
  }
}

export function parseArtifactBlock(value: unknown): ArtifactBlock | null {
  try {
    if (typeof value === 'string') {
      if (value.length > MAX_ARTIFACT_BYTES) return null;
      value = JSON.parse(value);
    }
    if (!isBoundedJson(value)) return null;
    const result = ArtifactBlockSchema.safeParse(value);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function serializeArtifactBlock(block: ArtifactBlock): string {
  const parsed = parseArtifactBlock(block);
  if (!parsed) throw new Error('Invalid visual artifact');
  // Escape angle brackets and backticks to keep HTML/script and fence-like text inert in notes.
  const body = JSON.stringify(parsed, null, 2).replace(/</g, '\\u003c').replace(/`/g, '\\u0060');
  return '```ws-block:artifact\n' + body + '\n```';
}

/** Complete, top-level Markdown fences only; examples inside code stay inert. */
export function extractArtifactFences(
  content: string,
): Array<{ start: number; end: number; block: ArtifactBlock }> {
  const result: Array<{ start: number; end: number; block: ArtifactBlock }> = [];
  const lines = /^.*(?:\n|$)/gm;
  let opening: { delimiter: string; artifact: boolean; start: number; bodyStart: number } | null =
    null;
  let line: RegExpExecArray | null;
  while ((line = lines.exec(content)) && line[0]) {
    const fence = line[0].match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n)?$/);
    if (!fence) continue;
    if (!opening) {
      opening = {
        delimiter: fence[1],
        artifact: fence[2].trim() === 'ws-block:artifact',
        start: line.index,
        bodyStart: lines.lastIndex,
      };
    } else if (
      fence[1][0] === opening.delimiter[0] &&
      fence[1].length >= opening.delimiter.length &&
      !fence[2].trim()
    ) {
      if (opening.artifact) {
        const block = parseArtifactBlock(content.slice(opening.bodyStart, line.index));
        if (block) result.push({ start: opening.start, end: lines.lastIndex, block });
      }
      opening = null;
    }
  }
  return result;
}

export function findArtifactDocument(
  content: string,
  artifactId: string,
): { document: ArtifactDocument; rawBlock: string } | null {
  const found = extractArtifactFences(content).flatMap(({ start, end, block }) =>
    'document' in block && block.document.id === artifactId
      ? [{ document: block.document, rawBlock: content.slice(start, end).replace(/\r?\n$/, '') }]
      : [],
  );
  return found.length === 1 ? found[0] : null;
}

export function createSelectionSnapshot(
  document: ArtifactDocument,
  selection: ArtifactSelection,
  source: ArtifactSelectionSnapshot['source'],
  comment = '',
): ArtifactSelectionSnapshot {
  if (!isBoundedJson(document)) throw new Error('Invalid visual artifact');
  const doc = ArtifactDocumentSchema.parse(document);
  const target = ArtifactSelectionSchema.parse(selection);
  if (source.artifactId !== doc.id) throw new Error('Artifact source identity does not match');
  if (target.region && doc.kind !== 'image') throw new Error('Regions require an image artifact');
  const selected = new Set(target.itemIds);
  if (target.itemIds.some((id) => !doc.items.some((item) => item.id === id)))
    throw new Error('Selection target is missing');
  const items = selected.size ? doc.items.filter((item) => selected.has(item.id)) : doc.items;
  const included = new Set(items.map((item) => item.id));
  const snapshot: ArtifactSelectionSnapshot = {
    version: 1,
    source,
    title: doc.title,
    kind: doc.kind,
    selection: target,
    items,
    connections: doc.connections.filter((edge) => included.has(edge.from) && included.has(edge.to)),
    annotations: doc.annotations.filter(
      (a) => !selected.size || a.selection.itemIds.some((id) => included.has(id)),
    ),
    ...(doc.image ? { image: doc.image } : {}),
    ...(doc.previewState !== undefined ? { previewState: doc.previewState } : {}),
    ...(doc.chosenIds ? { chosenIds: doc.chosenIds } : {}),
    comment: comment.slice(0, 16000),
  };
  return JSON.parse(JSON.stringify(snapshot)) as ArtifactSelectionSnapshot;
}
