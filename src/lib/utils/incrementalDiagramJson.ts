import {
  DiagramPrimitiveSchema,
  type DiagramPrimitive,
  type DiagramState,
} from '$shared/types/notes-primitives';

interface DiagramJsonResult {
  rawSource: string;
  status: 'partial' | 'complete' | 'invalid';
  diagram: DiagramPrimitive | null;
  error?: string;
}

interface JsonValue {
  value?: unknown;
  complete: boolean;
}

const modelSchema = DiagramPrimitiveSchema.shape.model;
const stateSchema = DiagramPrimitiveSchema.shape.states.unwrap().element;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only structural containers may be open. An entity is never a repaired object. */
function previewContainer(path: string): boolean {
  return /^(?:|model|model\.(?:nodes|edges|groups)|states)$/.test(path);
}

function readPrefix(source: string): JsonValue {
  let cursor = 0;
  const whitespace = () => {
    while (/[\t\n\r ]/.test(source[cursor] ?? '\0')) cursor += 1;
  };
  const read = (path: string, depth: number): JsonValue => {
    if (depth > 64) throw new Error('JSON nesting limit exceeded');
    whitespace();
    const start = cursor;
    const char = source[cursor];
    if (char === undefined) return { complete: false };
    if (char === '"') {
      cursor += 1;
      while (cursor < source.length) {
        const next = source[cursor++];
        if (next === '\\') cursor += 1;
        else if (next === '"') {
          return { value: JSON.parse(source.slice(start, cursor)), complete: true };
        }
      }
      return { complete: false };
    }
    if (char === '{' || char === '[') {
      const object = char === '{';
      const value: Record<string, unknown> | unknown[] = object ? Object.create(null) : [];
      const close = object ? '}' : ']';
      cursor += 1;
      whitespace();
      if (source[cursor] === close) {
        cursor += 1;
        return { value, complete: true };
      }
      while (cursor < source.length) {
        let key = '';
        if (object) {
          if (source[cursor] !== '"') throw new Error('Expected JSON property');
          const property = read(path, depth + 1);
          if (!property.complete) return { value, complete: false };
          key = property.value as string;
          whitespace();
          if (cursor === source.length) return { value, complete: false };
          if (source[cursor++] !== ':') throw new Error('Expected JSON colon');
        }
        const childPath = object ? (path ? `${path}.${key}` : key) : `${path}[]`;
        const child = read(childPath, depth + 1);
        if (child.complete || (previewContainer(childPath) && child.value !== undefined)) {
          if (Array.isArray(value)) value.push(child.value);
          else value[key] = child.value;
        }
        if (!child.complete) return { value, complete: false };
        whitespace();
        if (cursor === source.length) return { value, complete: false };
        if (source[cursor] === close) {
          cursor += 1;
          return { value, complete: true };
        }
        if (source[cursor++] !== ',') throw new Error('Expected JSON separator');
        whitespace();
      }
      return { value, complete: false };
    }
    while (cursor < source.length && !/[\t\n\r ,}\]]/.test(source[cursor])) cursor += 1;
    // A number at EOF may still grow (1 -> 12, 1e -> 1e2). Never guess its end.
    if (cursor === source.length) return { complete: false };
    return { value: JSON.parse(source.slice(start, cursor)), complete: true };
  };
  const result = read('', 0);
  whitespace();
  if (result.complete && cursor !== source.length) throw new Error('Unexpected JSON suffix');
  return result;
}

function unique<T extends { id: string }>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter(({ id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function resolvedState(
  state: DiagramState,
  nodes: Set<string>,
  edges: Set<string>,
  groups: Set<string>,
): boolean {
  return (
    [state.visibleNodes, state.highlightedNodes].every(
      (ids) => ids?.every((id) => nodes.has(id)) ?? true,
    ) &&
    [state.visibleEdges, state.highlightedEdges].every(
      (ids) => ids?.every((id) => edges.has(id)) ?? true,
    ) &&
    (state.visibleGroups?.every((id) => groups.has(id)) ?? true) &&
    (state.camera?.focus === undefined || nodes.has(state.camera.focus))
  );
}

function project(value: unknown): DiagramPrimitive | null {
  if (!record(value) || !record(value.model)) return null;
  const model = value.model;
  const valid = <T>(
    items: unknown,
    schema: { safeParse: (value: unknown) => { success: boolean } },
  ): T[] =>
    Array.isArray(items) ? (items.filter((item) => schema.safeParse(item).success) as T[]) : [];
  let nodes = unique(
    valid<DiagramPrimitive['model']['nodes'][number]>(model.nodes, modelSchema.shape.nodes.element),
  );
  let groups = unique(
    valid<NonNullable<DiagramPrimitive['model']['groups']>[number]>(
      model.groups,
      modelSchema.shape.groups.unwrap().element,
    ),
  );
  // Resolve node/group membership together: neither side may point at a deferred entity.
  let changed = true;
  while (changed) {
    const nodeIds = new Set(nodes.map(({ id }) => id));
    const nextGroups = groups.filter((group) => group.nodeIds.every((id) => nodeIds.has(id)));
    const groupIds = new Set(nextGroups.map(({ id }) => id));
    const nextNodes = nodes.filter((node) => node.group === undefined || groupIds.has(node.group));
    changed = nextNodes.length !== nodes.length || nextGroups.length !== groups.length;
    nodes = nextNodes;
    groups = nextGroups;
  }
  if (!nodes.length) return null;
  const nodeIds = new Set(nodes.map(({ id }) => id));
  const edges = unique(
    valid<DiagramPrimitive['model']['edges'][number]>(model.edges, modelSchema.shape.edges.element),
  ).filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const edgeIds = new Set(edges.map(({ id }) => id));
  const groupIds = new Set(groups.map(({ id }) => id));
  const states = unique(valid<DiagramState>(value.states, stateSchema)).filter((state) =>
    resolvedState(state, nodeIds, edgeIds, groupIds),
  );
  const projected: Record<string, unknown> = {
    ...value,
    model: { ...model, nodes, edges, ...(model.groups === undefined ? {} : { groups }) },
    ...(value.states === undefined ? {} : { states }),
  };
  if (!states.some((state) => state.id === projected.currentStateId))
    delete projected.currentStateId;
  return DiagramPrimitiveSchema.safeParse(projected).success
    ? (projected as unknown as DiagramPrimitive)
    : null;
}

function validateComplete(value: unknown): DiagramPrimitive | null {
  if (!DiagramPrimitiveSchema.safeParse(value).success) return null;
  const diagram = value as DiagramPrimitive;
  const { nodes, edges, groups = [] } = diagram.model;
  const states = diagram.states ?? [];
  const nodeIds = new Set(nodes.map(({ id }) => id));
  const edgeIds = new Set(edges.map(({ id }) => id));
  const groupIds = new Set(groups.map(({ id }) => id));
  if (
    [nodes, edges, groups, states].some(
      (items) => new Set(items.map(({ id }) => id)).size !== items.length,
    ) ||
    nodes.some((node) => node.group !== undefined && !groupIds.has(node.group)) ||
    edges.some((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) ||
    groups.some((group) => group.nodeIds.some((id) => !nodeIds.has(id))) ||
    states.some((state) => !resolvedState(state, nodeIds, edgeIds, groupIds)) ||
    (diagram.currentStateId !== undefined &&
      !states.some((state) => state.id === diagram.currentStateId))
  )
    return null;
  return diagram;
}

/**
 * A transient, reference-safe projection, never repaired/persistable JSON. Callers own
 * stream/fence identity and may retain a prior preview while status is partial. At
 * close, cancellation, or end, pass finalized=true and discard previews on invalid.
 */
export function parseIncrementalDiagramJson(source: string, finalized = false): DiagramJsonResult {
  const result = (
    status: DiagramJsonResult['status'],
    diagram: DiagramPrimitive | null,
    error?: string,
  ): DiagramJsonResult => ({ rawSource: source, status, diagram, ...(error ? { error } : {}) });
  try {
    if (finalized) {
      const diagram = validateComplete(JSON.parse(source));
      return diagram
        ? result('complete', diagram)
        : result('invalid', null, 'Invalid diagram payload');
    }
    const prefix = readPrefix(source);
    if (prefix.complete) {
      const diagram = validateComplete(prefix.value);
      if (diagram) return result('complete', diagram);
    }
    return result('partial', project(prefix.value));
  } catch {
    return result(
      finalized ? 'invalid' : 'partial',
      null,
      finalized ? 'Invalid diagram JSON' : undefined,
    );
  }
}
