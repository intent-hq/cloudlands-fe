import { describe, expect, it } from 'vitest';
import type { DiagramGrammar, DiagramPrimitive } from '$shared/types/notes-primitives';
import { computeLayout } from '$lib/components/diagrams/layout-engine';
import { parseIncrementalDiagramJson } from './incrementalDiagramJson';

const grammars: DiagramGrammar[] = [
  'architecture',
  'sequence',
  'state_machine',
  'data_flow',
  'network',
  'flowchart',
  'timeline',
  'dependency_graph',
];

function header(grammar: DiagramGrammar = 'flowchart') {
  return JSON.stringify({
    id: '10000000-0000-4000-8000-000000000001',
    type: 'diagram',
    version: 1,
    createdAt: '2026-09-22T00:00:00.000Z',
    createdBy: 'agent',
    grammar,
    baseView: { layout: { type: 'layered', direction: 'LR' } },
  }).slice(0, -1);
}

const one = '{"id":"a","label":"Input"}';
const two = '{"id":"b","label":"Output"}';
const edge = '{"id":"ab","from":"a","to":"b","label":"Sends"}';

describe('incremental custom diagram JSON', () => {
  it.each(grammars)(
    'grows %s model arrays before root closure and lays out the authored entities',
    (grammar) => {
      const first = `${header(grammar)},"model":{"nodes":[${one}`;
      const second = `${first},${two}],"edges":[${edge}`;
      for (const [source, nodeIds, edgeIds] of [
        [first, ['a'], []],
        [second, ['a', 'b'], ['ab']],
      ] as const) {
        expect(() => JSON.parse(source)).toThrow();
        const result = parseIncrementalDiagramJson(source);
        expect(result.status).toBe('partial');
        expect(result.rawSource).toBe(source);
        expect(result.diagram?.model.nodes.map(({ id }) => id)).toEqual(nodeIds);
        expect(result.diagram?.model.edges.map(({ id }) => id)).toEqual(edgeIds);
        const diagram = result.diagram!;
        const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);
        expect(layout.nodes.map(({ id }) => id)).toEqual(nodeIds);
        expect(layout.edges.map(({ id }) => id)).toEqual(edgeIds);
        expect(
          layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)),
        ).toBe(true);
      }
      const finalSource = `${second}]}}`;
      expect(parseIncrementalDiagramJson(finalSource, true)).toEqual({
        rawSource: finalSource,
        status: 'complete',
        diagram: JSON.parse(finalSource),
      });
    },
  );

  it('never emits an unfinished entity at any string, escape, numeric or nested boundary', () => {
    const node = JSON.stringify({
      id: 'b',
      label: 'Braces { [ ] } and "quotes" \\ newline\n😀',
      position: { x: -12.5e2, y: 10 },
      metadata: { nested: [true, null, { text: '\\"}' }] },
      binding: { type: 'file', target: 'src/example.ts' },
    });
    const prefix = `${header()},"model":{"nodes":[${one},`;
    for (let length = 0; length < node.length; length += 1) {
      const source = prefix + node.slice(0, length);
      const preview = parseIncrementalDiagramJson(source);
      expect(preview.rawSource).toBe(source);
      expect(
        preview.diagram?.model.nodes.map(({ id }) => id),
        `offset ${length}`,
      ).toEqual(['a']);
    }
    expect(parseIncrementalDiagramJson(prefix + node).diagram?.model.nodes).toEqual([
      JSON.parse(one),
      JSON.parse(node),
    ]);
  });

  it('defers forward edges, grouped members and states until every authored reference exists', () => {
    const states =
      '[{"id":"start","visibleNodes":["a"]},{"id":"finish","visibleNodes":["b"],"visibleEdges":["ab"],"visibleGroups":["pair"],"highlightedNodes":["b"],"highlightedEdges":["ab"],"camera":{"focus":"b"},"narrative":{"title":"Done","text":"Authored text"}}]';
    const prefix = `${header()},"currentStateId":"finish","states":${states},"model":{"edges":[${edge}],"groups":[{"id":"pair","label":"Pair","nodeIds":["b","c"]}],"nodes":[${one}`;
    const deferred = `${prefix},{"id":"b","label":"Output","group":"pair"}`;
    const resolved = `${deferred},{"id":"c","label":"Companion","group":"pair"}`;
    for (const source of [prefix, deferred]) {
      const preview = parseIncrementalDiagramJson(source).diagram!;
      expect(preview.model.nodes.map(({ id }) => id)).toEqual(['a']);
      expect(preview.model.edges).toEqual([]);
      expect(preview.model.groups).toEqual([]);
      expect(preview.states?.map(({ id }) => id)).toEqual(['start']);
      expect(preview.currentStateId).toBeUndefined();
    }
    const preview = parseIncrementalDiagramJson(resolved).diagram!;
    expect(preview.model.nodes.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect(preview.model.edges.map(({ id }) => id)).toEqual(['ab']);
    expect(preview.model.groups?.map(({ id }) => id)).toEqual(['pair']);
    expect(preview.states?.map(({ id }) => id)).toEqual(['start', 'finish']);
    expect(preview.currentStateId).toBe('finish');
    expect(preview.states?.[1].narrative).toEqual({ title: 'Done', text: 'Authored text' });
  });

  it('grows completed walkthrough steps inside an open states array without inventing a step', () => {
    const prefix = `${header()},"model":{"nodes":[${one},${two}],"edges":[${edge}]},"states":[`;
    expect(parseIncrementalDiagramJson(prefix).diagram?.states).toEqual([]);
    const first = `${prefix}{"id":"start","visibleNodes":["a"]}`;
    const second = `${first},{"id":"finish","visibleNodes":["a","b"],"visibleEdges":["ab"]}`;
    expect(parseIncrementalDiagramJson(first).diagram?.states?.map(({ id }) => id)).toEqual([
      'start',
    ]);
    expect(parseIncrementalDiagramJson(second).diagram?.states?.map(({ id }) => id)).toEqual([
      'start',
      'finish',
    ]);
    expect(
      parseIncrementalDiagramJson(
        `${first},{"id":"finish","narrative":"unfinished`,
      ).diagram?.states?.map(({ id }) => id),
    ).toEqual(['start']);
  });

  it('accepts arbitrary property order without manufacturing missing primitive headers', () => {
    const prefix = `{"model":{"nodes":[${one},${two}],"edges":[${edge}]}`;
    expect(parseIncrementalDiagramJson(prefix).diagram).toBeNull();
    const source = `${prefix},${header().slice(1)},"states":[{"id":"start"}`;
    expect(parseIncrementalDiagramJson(source).diagram?.model.nodes.map(({ id }) => id)).toEqual([
      'a',
      'b',
    ]);
    expect(parseIncrementalDiagramJson(source).diagram?.states?.map(({ id }) => id)).toEqual([
      'start',
    ]);
  });

  it.each([1, 7, 53, 10000])(
    'handles coalesced chunks of size %i with stable authored identity',
    (chunkSize) => {
      const source = `${header()},"model":{"nodes":[${one},${two}],"edges":[${edge}]}}`;
      let previousCount = 0;
      for (let end = chunkSize; end < source.length + chunkSize; end += chunkSize) {
        const preview = parseIncrementalDiagramJson(source.slice(0, end));
        if (!preview.diagram) continue;
        expect(preview.diagram.id).toBe('10000000-0000-4000-8000-000000000001');
        expect(preview.diagram.model.nodes.length).toBeGreaterThanOrEqual(previousCount);
        previousCount = preview.diagram.model.nodes.length;
      }
      expect(previousCount).toBe(2);
    },
  );

  it.each([
    '"visibleNodes":["missing"]',
    '"visibleEdges":["missing"]',
    '"visibleGroups":["missing"]',
    '"highlightedNodes":["missing"]',
    '"highlightedEdges":["missing"]',
    '"camera":{"focus":"missing"}',
  ])('defers and finally rejects dangling state reference %s', (reference) => {
    const source = `${header()},"model":{"nodes":[${one}],"edges":[]},"states":[{"id":"bad",${reference}}]`;
    expect(parseIncrementalDiagramJson(source).diagram?.states).toEqual([]);
    expect(parseIncrementalDiagramJson(`${source}}`, true).status).toBe('invalid');
  });

  it.each([
    (source: string) => source.slice(0, -1),
    (source: string) => source + ' garbage',
    (source: string) =>
      source.replace('"edges":[]', '"edges":[{"id":"bad","from":"a","to":"missing"}]'),
    (source: string) => source.replace('"nodes":[', '"nodes":[{"id":"a","label":"Duplicate"},'),
    (source: string) =>
      source.replace(
        '"edges":[]',
        '"edges":[],"groups":[{"id":"bad","label":"Bad","nodeIds":["missing"]}]',
      ),
    (source: string) => source.replace('"label":"Input"', '"label":12'),
    (source: string) => source.replace('"edges":[]', '"edges":[],"nodes":null'),
    (source: string) => source.replace('"grammar":"flowchart"', '"grammar":"unsupported"'),
    (source: string) => source.replace('"version":1', '"version":2'),
  ])('never repairs invalid or truncated final data (%#)', (corrupt) => {
    const valid = `${header()},"model":{"nodes":[${one}],"edges":[]}}`;
    const source = corrupt(valid);
    const result = parseIncrementalDiagramJson(source, true);
    expect(result.status).toBe('invalid');
    expect(result.diagram).toBeNull();
    expect(result.rawSource).toBe(source);
    expect(result.error).toBeTruthy();
  });

  it('returns complete valid source verbatim, including bindings and unknown metadata', () => {
    const source = `${header()},"model":{"nodes":[${one}],"edges":[]},"metadata":{"future":{"nested":[1,true,null]}}}`;
    const result = parseIncrementalDiagramJson(`\n ${source}\n`, true);
    expect(result.diagram).toEqual(JSON.parse(source) as DiagramPrimitive);
    expect(result.rawSource).toBe(`\n ${source}\n`);
  });
});
