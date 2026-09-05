import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DiagramPrimitiveSchema } from '$shared/types/notes-primitives';
import { validateDiagram } from './diagram-validator';
import { computeLayout } from './layout-engine';
import {
  CUSTOM_WORKBENCH_CASES,
  DIAGRAM_WORKBENCH_CASE_GROUPS,
  DIAGRAM_WORKBENCH_CASE_IDS,
  DIAGRAM_WORKBENCH_CASES,
  DIAGRAM_WORKBENCH_CUSTOM_CASE_IDS,
  DIAGRAM_WORKBENCH_MERMAID_CASE_IDS,
  MERMAID_WORKBENCH_CASES,
} from './diagram-workbench.preview-fixtures';

describe('diagram workbench fixtures', () => {
  it('publishes stable IDs from one authoritative registry', () => {
    expect(DIAGRAM_WORKBENCH_CASE_IDS).toEqual(Object.keys(DIAGRAM_WORKBENCH_CASES));
    expect(DIAGRAM_WORKBENCH_MERMAID_CASE_IDS).toEqual(
      DIAGRAM_WORKBENCH_CASE_IDS.filter((id) => DIAGRAM_WORKBENCH_CASES[id].kind !== 'custom'),
    );
    expect(DIAGRAM_WORKBENCH_CUSTOM_CASE_IDS).toEqual(
      DIAGRAM_WORKBENCH_CASE_IDS.filter((id) => DIAGRAM_WORKBENCH_CASES[id].kind === 'custom'),
    );
    expect(DIAGRAM_WORKBENCH_CASE_IDS).toEqual(
      expect.arrayContaining([
        'mermaid-nested-routing',
        'mermaid-minimal-sequence',
        'mermaid-state-recovery',
        'mermaid-minimal-state',
        'mermaid-minimal-class',
        'mermaid-minimal-entity-relationship',
        'custom-service-boundaries',
        'custom-delivery-walkthrough',
      ]),
    );
  });

  it('groups every case once in stable single-page order', () => {
    const groupedCases = DIAGRAM_WORKBENCH_CASE_GROUPS.flatMap(({ caseIds }) => caseIds);

    expect(DIAGRAM_WORKBENCH_CASE_GROUPS.map(({ id }) => id)).toEqual([
      'mermaid',
      'stress',
      'custom',
      'interaction',
      'status',
    ]);
    expect(groupedCases).toHaveLength(DIAGRAM_WORKBENCH_CASE_IDS.length);
    expect(new Set(groupedCases).size).toBe(DIAGRAM_WORKBENCH_CASE_IDS.length);
    expect(groupedCases.sort()).toEqual(Object.keys(DIAGRAM_WORKBENCH_CASES).sort());
  });

  it('keeps representative Mermaid grammars and stress cases in the integrated fixture', () => {
    expect(MERMAID_WORKBENCH_CASES['mermaid-flow'].source).toMatch(/^flowchart LR/);
    expect(MERMAID_WORKBENCH_CASES['mermaid-single-node'].source).toContain('唯一のノード');
    expect(MERMAID_WORKBENCH_CASES['mermaid-two-node'].source.match(/-->/g)).toHaveLength(1);
    expect(MERMAID_WORKBENCH_CASES['mermaid-disconnected'].source).toContain(
      'Disconnected observer',
    );
    expect(MERMAID_WORKBENCH_CASES['mermaid-topology-stress'].source).toContain('B --> B');
    expect(MERMAID_WORKBENCH_CASES['mermaid-nested-groups'].source).toContain('subgraph Inner');
    expect(MERMAID_WORKBENCH_CASES['mermaid-sequence'].source).toMatch(/^sequenceDiagram/);
    expect(MERMAID_WORKBENCH_CASES['mermaid-state'].source).toMatch(/^stateDiagram-v2/);
    expect(MERMAID_WORKBENCH_CASES['mermaid-state'].source).toContain(
      'RunningTool --> Streaming: Tool completes',
    );
    expect(MERMAID_WORKBENCH_CASES['mermaid-class'].source).toMatch(/^classDiagram/);
    expect(MERMAID_WORKBENCH_CASES['mermaid-entity-relationship'].source).toMatch(/^erDiagram/);
    expect(MERMAID_WORKBENCH_CASES['mermaid-groups'].source).toContain('subgraph Browser');
    expect(MERMAID_WORKBENCH_CASES['mermaid-dense-graph'].source.match(/-->/g)).toHaveLength(11);
    expect(MERMAID_WORKBENCH_CASES['mermaid-long-labels'].source.match(/<br\/>/g)).toHaveLength(3);
    expect(MERMAID_WORKBENCH_CASES['mermaid-multiline-labels'].source).toContain('<br/>');
    expect(MERMAID_WORKBENCH_CASES['mermaid-cycle-fanout'].source).toContain('Review --> Hub');
    expect(MERMAID_WORKBENCH_CASES['mermaid-invalid-source'].source).toContain('Missing close');
    expect(MERMAID_WORKBENCH_CASES['mermaid-empty-content'].source).toBe('');
    expect(DIAGRAM_WORKBENCH_CASES['mermaid-loading'].kind).toBe('loading');
  });

  it('defines minimal examples and explicit contracts for the added showcase cases', () => {
    const showcaseIds = [
      'mermaid-single-node',
      'mermaid-minimal-sequence',
      'mermaid-minimal-state',
      'mermaid-state-recovery',
      'mermaid-minimal-class',
      'mermaid-minimal-entity-relationship',
      'mermaid-nested-routing',
      'custom-service-boundaries',
      'custom-delivery-walkthrough',
    ] as const;

    for (const id of showcaseIds) {
      const fixture = DIAGRAM_WORKBENCH_CASES[id];
      expect(fixture.title.trim()).not.toBe('');
      expect(fixture.description.trim()).not.toBe('');
      expect(fixture.visualContract?.trim()).not.toBe('');
    }
  });

  it('keeps the loading case localized, text-only, motionless, and UI-led', () => {
    const source = readFileSync(
      'src/lib/components/diagrams/diagram-workbench.preview.svelte',
      'utf8',
    );

    expect(source).toContain('role="status"');
    expect(source).toContain('m.sandbox_diagramWorkbench_loading_ariaLabel()');
    expect(source).toContain('m.sandbox_diagramWorkbench_loading_label()');
    expect(source.match(/\.loading-state \{[\s\S]*?\n  \}/)?.[0]).toContain(
      'font-family: var(--font-ui)',
    );
    expect(source).not.toContain('<span aria-hidden="true"></span>');
    expect(source).not.toContain('@keyframes spin');
    expect(source).not.toContain('var(--font-mono)');
  });

  it('keeps every custom grammar deterministic and schema-valid', () => {
    const cases = Object.values(CUSTOM_WORKBENCH_CASES);
    const grammars = new Set<string>();

    for (const fixture of cases) {
      expect(fixture.kind).toBe('custom');
      if (fixture.kind !== 'custom') continue;
      expect(DiagramPrimitiveSchema.safeParse(fixture.diagram).success).toBe(true);
      expect(validateDiagram(fixture.diagram).errors).toEqual([]);
      expect(fixture.diagram.createdAt).toBe('2026-08-23T12:00:00.000Z');
      grammars.add(fixture.diagram.grammar);
    }

    expect([...grammars].sort()).toEqual([
      'architecture',
      'data_flow',
      'dependency_graph',
      'flowchart',
      'network',
      'sequence',
      'state_machine',
      'timeline',
    ]);
  });

  it('includes groups, walkthroughs, semantic styles, and file and note bindings', () => {
    const architecture = CUSTOM_WORKBENCH_CASES['custom-architecture'];
    expect(architecture.kind).toBe('custom');
    if (architecture.kind !== 'custom') return;

    expect(architecture.diagram.model.groups).toHaveLength(2);
    expect(architecture.diagram.states?.map(({ id }) => id)).toEqual([
      'orient',
      'connect',
      'observe',
    ]);
    expect(architecture.diagram.model.nodes.map(({ semanticStyle }) => semanticStyle)).toEqual(
      expect.arrayContaining(['active', 'success']),
    );
    expect(architecture.diagram.model.nodes.flatMap(({ binding }) => binding?.type ?? [])).toEqual(
      expect.arrayContaining(['file', 'note']),
    );
  });

  it('models disconnected service groups and staged delivery state changes', () => {
    const boundaries = CUSTOM_WORKBENCH_CASES['custom-service-boundaries'];
    const walkthrough = CUSTOM_WORKBENCH_CASES['custom-delivery-walkthrough'];
    expect(boundaries.kind).toBe('custom');
    expect(walkthrough.kind).toBe('custom');
    if (boundaries.kind !== 'custom' || walkthrough.kind !== 'custom') return;

    expect(boundaries.diagram.model.groups).toHaveLength(4);
    expect(boundaries.diagram.model.nodes.filter(({ kind }) => kind === 'db')).toHaveLength(2);
    const connectedNodeIds = new Set(
      boundaries.diagram.model.edges.flatMap(({ from, to }) => [from, to]),
    );
    expect(['metrics', 'dashboard'].every((id) => connectedNodeIds.has(id))).toBe(true);
    expect(
      boundaries.diagram.model.edges.some(
        ({ from, to }) => !['metrics', 'dashboard'].includes(from) && to === 'dashboard',
      ),
    ).toBe(false);

    const states = walkthrough.diagram.states ?? [];
    expect(states).toHaveLength(4);
    expect(states.every(({ camera }) => Boolean(camera?.focus))).toBe(true);
    expect(new Set(states.flatMap(({ visibleGroups }) => visibleGroups ?? [])).size).toBe(3);
    expect(new Set(states.map(({ visibleNodes }) => visibleNodes?.join('|'))).size).toBe(
      states.length,
    );
    expect(new Set(states.map(({ visibleEdges }) => visibleEdges?.join('|'))).size).toBe(
      states.length,
    );
  });

  it.each(Object.entries(CUSTOM_WORKBENCH_CASES))(
    'computes a finite integrated layout for %s',
    (_state, fixture) => {
      expect(fixture.kind).toBe('custom');
      if (fixture.kind !== 'custom') return;

      const layout = computeLayout(
        fixture.diagram.model,
        fixture.diagram.baseView,
        fixture.diagram.grammar,
      );
      expect(layout.nodes).toHaveLength(fixture.diagram.model.nodes.length);
      expect(layout.edges).toHaveLength(fixture.diagram.model.edges.length);
      for (const node of layout.nodes) {
        expect([node.x, node.y, node.width, node.height].every(Number.isFinite)).toBe(true);
        expect(node.width).toBeGreaterThan(0);
        expect(node.height).toBeGreaterThan(0);
      }
      for (const edge of layout.edges) {
        expect(edge.path).toMatch(/^M/);
        expect(edge.points?.flatMap(({ x, y }) => [x, y]).every(Number.isFinite)).toBe(true);
      }
    },
  );

  it('preserves exact manual-column centers and a straight route', () => {
    const fixture = CUSTOM_WORKBENCH_CASES['custom-disconnected-extremes'];
    expect(fixture.kind).toBe('custom');
    if (fixture.kind !== 'custom') return;
    const layout = computeLayout(
      fixture.diagram.model,
      fixture.diagram.baseView,
      fixture.diagram.grammar,
    );
    const unicode = layout.nodes.find(({ id }) => id === 'unicode')!;
    const multiline = layout.nodes.find(({ id }) => id === 'multiline')!;
    const route = layout.edges.find(({ id }) => id === 'x2')!;

    expect(unicode.x + unicode.width / 2).toBe(multiline.x + multiline.width / 2);
    expect(route.points).toEqual([
      { x: unicode.x + unicode.width / 2, y: unicode.y + unicode.height },
      { x: multiline.x + multiline.width / 2, y: multiline.y },
    ]);
  });

  it('keeps exact distinct bottom and side ports for the topology fan-out', () => {
    const fixture = CUSTOM_WORKBENCH_CASES['custom-topology-stress'];
    expect(fixture.kind).toBe('custom');
    if (fixture.kind !== 'custom') return;
    const layout = computeLayout(
      fixture.diagram.model,
      fixture.diagram.baseView,
      fixture.diagram.grammar,
    );
    const hub = layout.nodes.find(({ id }) => id === 'hub')!;
    const start = (id: string) => layout.edges.find((edge) => edge.id === id)!.points![0];
    const centerX = hub.x + hub.width / 2;

    expect(start('z6')).toEqual({ x: centerX - 16, y: hub.y + hub.height });
    expect(start('z7')).toEqual({ x: centerX + 16, y: hub.y + hub.height });
    expect(start('z8')).toEqual({ x: hub.x + hub.width, y: hub.y + hub.height / 2 });
  });
});
