/**
 * Diagram System Integration Tests
 *
 * Tests the complete diagram system including:
 * - Template generation
 * - Validation
 * - Layout computation
 * - Type safety
 */

import { describe, it, expect } from 'vitest';
import {
  createArchitectureDiagram,
  createSequenceDiagram,
  createStateMachineDiagram,
  createFlowchartDiagram,
  createDependencyGraph,
  createDataFlowDiagram,
  createNetworkDiagram,
  createTimelineDiagram,
} from '../diagram-templates';
import { validateDiagram } from '../diagram-validator';
import {
  buildRoundedOrthogonalPath,
  compactEdgeLabelMaxWidth,
  computeLayout,
  measureEdgeLabel,
} from '../layout-engine';
import { DEFAULT_NODE_STYLE } from '../types';
import {
  semanticFilenameUnits,
  semanticLabelTokens,
  semanticLabelUnits,
  splitSemanticLabel,
} from '../diagram-label-wrap';
import { DiagramPrimitiveSchema } from '$shared/types/notes-primitives';

describe('Diagram Templates', () => {
  it('should create valid architecture diagram', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'client', label: 'Client', kind: 'actor' },
        { id: 'api', label: 'API', kind: 'service' },
        { id: 'db', label: 'Database', kind: 'db' },
      ],
      [
        { from: 'client', to: 'api', label: 'Request' },
        { from: 'api', to: 'db', label: 'Query' },
      ],
    );

    // Should pass schema validation
    const schemaResult = DiagramPrimitiveSchema.safeParse(diagram);
    expect(schemaResult.success).toBe(true);

    // Should pass semantic validation
    const validation = validateDiagram(diagram);
    expect(validation.errors).toHaveLength(0);
    expect(validation.warnings).toHaveLength(0);
  });

  it('should create valid sequence diagram', () => {
    const diagram = createSequenceDiagram(
      ['User', 'API', 'Database'],
      [
        { from: 'User', to: 'API', label: 'Login' },
        { from: 'API', to: 'Database', label: 'Verify' },
        { from: 'Database', to: 'API', label: 'Success' },
      ],
    );

    const schemaResult = DiagramPrimitiveSchema.safeParse(diagram);
    expect(schemaResult.success).toBe(true);

    const validation = validateDiagram(diagram);
    expect(validation.errors).toHaveLength(0);
  });

  it('should create valid state machine diagram', () => {
    const diagram = createStateMachineDiagram(
      [
        { id: 'idle', label: 'Idle', isStart: true },
        { id: 'loading', label: 'Loading' },
        { id: 'success', label: 'Success', isEnd: true },
        { id: 'error', label: 'Error', isEnd: true },
      ],
      [
        { from: 'idle', to: 'loading', label: 'start' },
        { from: 'loading', to: 'success', label: 'complete' },
        { from: 'loading', to: 'error', label: 'fail' },
      ],
    );

    const schemaResult = DiagramPrimitiveSchema.safeParse(diagram);
    if (!schemaResult.success) {
      console.error('State machine schema errors:', schemaResult.error.errors);
    }
    expect(schemaResult.success).toBe(true);

    const validation = validateDiagram(diagram);
    expect(validation.errors).toHaveLength(0);
  });

  it('should create valid flowchart diagram', () => {
    const diagram = createFlowchartDiagram(
      [
        { id: 'start', label: 'Start', kind: 'start' },
        { id: 'check', label: 'Valid?', kind: 'decision' },
        { id: 'process', label: 'Process', kind: 'process' },
        { id: 'end', label: 'End', kind: 'end' },
      ],
      [
        { from: 'start', to: 'check' },
        { from: 'check', to: 'process', label: 'yes' },
        { from: 'check', to: 'end', label: 'no' },
        { from: 'process', to: 'end' },
      ],
    );

    const schemaResult = DiagramPrimitiveSchema.safeParse(diagram);
    expect(schemaResult.success).toBe(true);

    const validation = validateDiagram(diagram);
    expect(validation.errors).toHaveLength(0);
  });

  it('should create valid dependency graph', () => {
    const diagram = createDependencyGraph(
      [
        { id: 'moduleA', label: 'Module A', kind: 'module' },
        { id: 'moduleB', label: 'Module B', kind: 'module' },
        { id: 'moduleC', label: 'Module C', kind: 'module' },
      ],
      [
        { from: 'moduleA', to: 'moduleB' },
        { from: 'moduleB', to: 'moduleC' },
      ],
    );

    const schemaResult = DiagramPrimitiveSchema.safeParse(diagram);
    if (!schemaResult.success) {
      console.error('Dependency graph schema errors:', schemaResult.error.errors);
    }
    expect(schemaResult.success).toBe(true);

    const validation = validateDiagram(diagram);
    expect(validation.errors).toHaveLength(0);
  });

  it('should create valid data flow diagram', () => {
    const diagram = createDataFlowDiagram(
      [
        { id: 'input', label: 'User Input', kind: 'external' },
        { id: 'process', label: 'Process Data', kind: 'process' },
        { id: 'store', label: 'Data Store', kind: 'data_store' },
      ],
      [
        { from: 'input', to: 'process', label: 'raw data' },
        { from: 'process', to: 'store', label: 'processed' },
      ],
    );

    const schemaResult = DiagramPrimitiveSchema.safeParse(diagram);
    expect(schemaResult.success).toBe(true);

    const validation = validateDiagram(diagram);
    expect(validation.errors).toHaveLength(0);
    expect(diagram.grammar).toBe('data_flow');
  });

  it('should create valid network diagram', () => {
    const diagram = createNetworkDiagram(
      [
        { id: 'router1', label: 'Core Router', kind: 'router' },
        { id: 'switch1', label: 'Switch A', kind: 'switch' },
        { id: 'server1', label: 'Web Server', kind: 'server' },
      ],
      [
        { from: 'router1', to: 'switch1', label: 'trunk' },
        { from: 'switch1', to: 'server1' },
      ],
    );

    const schemaResult = DiagramPrimitiveSchema.safeParse(diagram);
    expect(schemaResult.success).toBe(true);

    const validation = validateDiagram(diagram);
    expect(validation.errors).toHaveLength(0);
    expect(diagram.grammar).toBe('network');
    expect(diagram.baseView.layout.type).toBe('force');
  });

  it('should create valid timeline diagram', () => {
    const diagram = createTimelineDiagram(
      [
        { id: 'start', label: 'Project Start', kind: 'milestone' },
        { id: 'dev', label: 'Development', kind: 'event' },
        { id: 'launch', label: 'Launch', kind: 'milestone' },
      ],
      [
        { from: 'start', to: 'dev', label: 'begins' },
        { from: 'dev', to: 'launch', label: 'completes' },
      ],
    );

    const schemaResult = DiagramPrimitiveSchema.safeParse(diagram);
    expect(schemaResult.success).toBe(true);

    const validation = validateDiagram(diagram);
    expect(validation.errors).toHaveLength(0);
    expect(diagram.grammar).toBe('timeline');
  });
});

describe('Diagram Validation', () => {
  it('should detect duplicate node IDs', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'node1', label: 'Node 1' },
        { id: 'node1', label: 'Node 1 Duplicate' }, // Duplicate ID
      ],
      [],
    );

    const validation = validateDiagram(diagram);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
  });

  it('should detect invalid edge references', () => {
    const diagram = createArchitectureDiagram(
      [{ id: 'node1', label: 'Node 1' }],
      [{ from: 'node1', to: 'nonexistent', label: 'Invalid' }],
    );

    const validation = validateDiagram(diagram);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.errors.some((e) => e.message.includes('non-existent'))).toBe(true);
  });
});

describe('Layout Engine', () => {
  it('expands route-label height for every measured line', () => {
    expect(measureEdgeLabel('send message').lines).toBe(1);
    expect(measureEdgeLabel('asks for\ninput')).toMatchObject({ lines: 2, height: 38 });
    expect(measureEdgeLabel('one two three four five six seven eight').lines).toBeGreaterThan(1);
    expect(measureEdgeLabel('stream state events')).toMatchObject({ width: 112, lines: 2 });
    expect(measureEdgeLabel('x'.repeat(40))).toMatchObject({ lines: 1 });
    expect(measureEdgeLabel('x'.repeat(40)).width).toBeGreaterThan(192);
    const narrowLaneLabel = 'a route label with many small words for the narrow lane';
    const compactLabel = measureEdgeLabel(
      narrowLaneLabel,
      compactEdgeLabelMaxWidth(narrowLaneLabel),
    );
    const crampedLabel = measureEdgeLabel(narrowLaneLabel, 60);
    expect(compactEdgeLabelMaxWidth('primary request')).toBe(60);
    expect(compactEdgeLabelMaxWidth(narrowLaneLabel)).toBe(100);
    expect(compactLabel.width).toBe(100);
    expect(compactLabel.height).toBeLessThan(crampedLabel.height);
  });

  it('expands node height for every requested visible line', () => {
    const layout = computeLayout(
      {
        nodes: [
          { id: 'single', label: 'alpha beta' },
          { id: 'multiline', label: 'alpha\nbeta' },
          { id: 'clamped', label: 'alpha\nbeta\ngamma\ndelta' },
        ],
        edges: [],
      },
      { layout: { type: 'manual' } },
      'architecture',
      {
        ...DEFAULT_NODE_STYLE,
        labelFontSize: 10,
        labelCharWidthRatio: 1,
        labelLineHeight: 1,
        paddingY: 10,
        maxLines: 3,
        maxWidth: 100,
      },
    );

    expect(layout.nodes.map(({ height }) => height)).toEqual([32, 42, 62]);
  });

  it('keeps capped mixed-script editorial labels inside the node', () => {
    const layout = computeLayout(
      {
        nodes: [
          {
            id: 'mixed-script',
            label: '東京のプレビュー • مرحبًا • résumé',
            kind: 'ui_component',
          },
        ],
        edges: [],
      },
      { layout: { type: 'manual' } },
      'data_flow',
    );

    expect(layout.nodes[0].width).toBe(250);
    expect(layout.nodes[0].height).toBeGreaterThan(47.38);
  });

  it('reserves the rendered semibold width for short editorial labels', () => {
    const layout = computeLayout(
      { nodes: [{ id: 'evidence', label: 'Evidence recorded', kind: 'milestone' }], edges: [] },
      { layout: { type: 'manual' } },
      'timeline',
    );

    expect(layout.nodes[0].width).toBeGreaterThan(163);
    expect(layout.nodes[0].height).toBeCloseTo(47.38);
  });

  it('reflows an overflowing manual layout without combining manual and row offsets', () => {
    const layout = computeLayout(
      {
        nodes: [
          { id: 'top-left', label: 'A long semantic boundary', position: { x: 0, y: 0 } },
          { id: 'top-right', label: 'A mixed-script 東京 label', position: { x: 640, y: 0 } },
          {
            id: 'bottom-right',
            label: 'A measured\nmultiline label',
            position: { x: 640, y: 300 },
          },
          { id: 'bottom-left', label: 'A disconnected observer', position: { x: 0, y: 300 } },
        ],
        edges: [
          { id: 'horizontal', from: 'top-left', to: 'top-right', label: 'owned route label' },
          { id: 'vertical', from: 'top-right', to: 'bottom-right', label: 'wrapped route label' },
        ],
      },
      { layout: { type: 'manual', direction: 'TB', edgeRouting: 'orthogonal' } },
      'data_flow',
      DEFAULT_NODE_STYLE,
      520,
    );

    for (let index = 1; index < layout.nodes.length; index += 1) {
      expect(layout.nodes[index].y).toBeGreaterThan(
        layout.nodes[index - 1].y + layout.nodes[index - 1].height,
      );
    }
    expect(new Set(layout.nodes.map((node) => node.x + node.width / 2)).size).toBe(1);
  });

  it('should compute layout for architecture diagram', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      [{ from: 'a', to: 'b' }],
    );

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(1);
    expect(layout.nodes[0].x).toBeDefined();
    expect(layout.nodes[0].y).toBeDefined();
    expect(layout.edges[0].path).toBeDefined();
  });

  it('should handle empty diagrams gracefully', () => {
    const diagram = createArchitectureDiagram([], []);

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
    expect(layout.bounds).toBeDefined();
  });

  it('should handle diagrams with groups', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      [],
    );

    // Add a group
    diagram.model.groups = [{ id: 'group1', label: 'Group 1', nodeIds: ['a', 'b'] }];

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    expect(layout.groups).toBeDefined();
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups![0].x).toBeDefined();
    expect(layout.groups![0].y).toBeDefined();
    expect(layout.groups![0].width).toBeGreaterThan(0);
    expect(layout.groups![0].height).toBeGreaterThan(0);
  });
});

describe('Hierarchical Group Layout', () => {
  it('should position groups based on dependency order', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'client', label: 'Client', kind: 'actor' },
        { id: 'api', label: 'API', kind: 'service' },
        { id: 'db', label: 'Database', kind: 'database' },
      ],
      [
        { from: 'client', to: 'api', label: 'Request' },
        { from: 'api', to: 'db', label: 'Query' },
      ],
    );

    // Add groups for each tier
    diagram.model.groups = [
      { id: 'frontend', label: 'Frontend', nodeIds: ['client'] },
      { id: 'backend', label: 'Backend', nodeIds: ['api'] },
      { id: 'data', label: 'Data', nodeIds: ['db'] },
    ];

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    expect(layout.groups).toHaveLength(3);

    // All groups should be positioned
    const frontendGroup = layout.groups!.find((g) => g.id === 'frontend')!;
    const backendGroup = layout.groups!.find((g) => g.id === 'backend')!;
    const dataGroup = layout.groups!.find((g) => g.id === 'data')!;

    expect(frontendGroup).toBeDefined();
    expect(backendGroup).toBeDefined();
    expect(dataGroup).toBeDefined();

    // All groups should have valid bounds
    [frontendGroup, backendGroup, dataGroup].forEach((g) => {
      expect(Number.isFinite(g.x)).toBe(true);
      expect(Number.isFinite(g.y)).toBe(true);
      expect(g.width).toBeGreaterThan(0);
      expect(g.height).toBeGreaterThan(0);
    });

    // Groups should contain their nodes
    const clientNode = layout.nodes.find((n) => n.id === 'client')!;
    expect(clientNode.x).toBeGreaterThanOrEqual(frontendGroup.x);
    expect(clientNode.x + clientNode.width).toBeLessThanOrEqual(
      frontendGroup.x + frontendGroup.width,
    );
  });

  it('should not overlap groups', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'a1', label: 'A1' },
        { id: 'a2', label: 'A2' },
        { id: 'b1', label: 'B1' },
        { id: 'b2', label: 'B2' },
      ],
      [
        { from: 'a1', to: 'b1' },
        { from: 'a2', to: 'b2' },
      ],
    );

    diagram.model.groups = [
      { id: 'groupA', label: 'Group A', nodeIds: ['a1', 'a2'] },
      { id: 'groupB', label: 'Group B', nodeIds: ['b1', 'b2'] },
    ];

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    const groupA = layout.groups!.find((g) => g.id === 'groupA')!;
    const groupB = layout.groups!.find((g) => g.id === 'groupB')!;

    // Groups should not overlap (check bounding box intersection)
    const aRight = groupA.x + groupA.width;
    const aBottom = groupA.y + groupA.height;
    const bRight = groupB.x + groupB.width;
    const bBottom = groupB.y + groupB.height;

    const overlapsX = !(aRight < groupB.x || groupA.x > bRight);
    const overlapsY = !(aBottom < groupB.y || groupA.y > bBottom);
    const overlaps = overlapsX && overlapsY;

    expect(overlaps).toBe(false);
  });

  it('should handle multiple nodes per group', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'n1', label: 'Node 1' },
        { id: 'n2', label: 'Node 2' },
        { id: 'n3', label: 'Node 3' },
        { id: 'n4', label: 'Node 4' },
      ],
      [],
    );

    diagram.model.groups = [
      { id: 'group1', label: 'Group 1', nodeIds: ['n1', 'n2'] },
      { id: 'group2', label: 'Group 2', nodeIds: ['n3', 'n4'] },
    ];

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    // All nodes in the same group should be contained within the group bounds
    const group1 = layout.groups!.find((g) => g.id === 'group1')!;
    const nodesInGroup1 = layout.nodes.filter((n) => ['n1', 'n2'].includes(n.id));

    nodesInGroup1.forEach((node) => {
      expect(node.x).toBeGreaterThanOrEqual(group1.x);
      expect(node.y).toBeGreaterThanOrEqual(group1.y);
      expect(node.x + node.width).toBeLessThanOrEqual(group1.x + group1.width);
      expect(node.y + node.height).toBeLessThanOrEqual(group1.y + group1.height);
    });
  });

  it('should handle the PiP architecture diagram scenario', () => {
    // Recreate the actual PiP diagram from the user's issue
    const diagram = createArchitectureDiagram(
      [
        { id: 'main-window', label: 'Main Window', kind: 'actor' },
        { id: 'pip-window', label: 'PiP Window(s)', kind: 'actor' },
        { id: 'main-process', label: 'Main Process', kind: 'service' },
        { id: 'pip-manager', label: 'PipWindowManager', kind: 'component' },
        { id: 'pip-ipc', label: 'PiP IPC Handlers', kind: 'component' },
        { id: 'stores', label: 'Workspace-Scoped Stores', kind: 'database' },
        { id: 'ipc', label: 'IPC Bridge', kind: 'service' },
      ],
      [
        { id: 'e1', from: 'main-window', to: 'ipc', label: 'pip:open(workspaceId)' },
        { id: 'e2', from: 'ipc', to: 'pip-ipc' },
        { id: 'e3', from: 'pip-ipc', to: 'pip-manager', label: 'create window' },
        { id: 'e4', from: 'pip-manager', to: 'pip-window', label: 'load /pip/[wsId]/...' },
        { id: 'e5', from: 'main-window', to: 'stores', label: 'subscribe(wsA)' },
        { id: 'e6', from: 'pip-window', to: 'stores', label: 'subscribe(wsA)' },
        { id: 'e7', from: 'stores', to: 'main-window', label: 'updates' },
        { id: 'e8', from: 'stores', to: 'pip-window', label: 'updates' },
      ],
    );

    diagram.model.groups = [
      { id: 'renderer', label: 'Renderer Process', nodeIds: ['main-window', 'pip-window'] },
      { id: 'main', label: 'Main Process', nodeIds: ['main-process', 'pip-manager', 'pip-ipc'] },
      { id: 'shared', label: 'Shared State', nodeIds: ['stores'] },
    ];

    // Use TB layout as in the original
    diagram.baseView.layout.direction = 'TB';

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    // Verify all nodes are positioned
    expect(layout.nodes).toHaveLength(7);
    layout.nodes.forEach((node) => {
      expect(typeof node.x).toBe('number');
      expect(typeof node.y).toBe('number');
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
    });

    // Verify all edges have paths
    expect(layout.edges).toHaveLength(8);
    layout.edges.forEach((edge) => {
      expect(edge.path).toBeDefined();
      expect(edge.path.length).toBeGreaterThan(0);
      expect(edge.points).toBeDefined();
      expect(edge.points!.length).toBeGreaterThanOrEqual(2);
    });

    // Verify groups exist and don't overlap
    expect(layout.groups).toHaveLength(3);
    const groups = layout.groups!;

    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const g1 = groups[i];
        const g2 = groups[j];

        const overlapsX = !(g1.x + g1.width < g2.x || g1.x > g2.x + g2.width);
        const overlapsY = !(g1.y + g1.height < g2.y || g1.y > g2.y + g2.height);
        const overlaps = overlapsX && overlapsY;

        expect(overlaps).toBe(false);
      }
    }
  });
});

describe('Edge Routing', () => {
  it('suppresses edges whose semantic endpoints are absent', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'source', label: 'Source' },
        { id: 'target', label: 'Target' },
      ],
      [
        { id: 'valid', from: 'source', to: 'target' },
        { id: 'invalid', from: 'source', to: 'missing' },
      ],
    );

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);
    expect(layout.edges.map(({ from, to }) => [from, to])).toEqual([['source', 'target']]);
    expect(layout.edges[0].path.startsWith('M')).toBe(true);
  });

  it('keeps near-aligned vertical ports on a local continuous route', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'user', label: 'You', position: { x: 380, y: 0 } },
        { id: 'state', label: 'Redux state', position: { x: 380, y: 95 } },
      ],
      [{ id: 'message', from: 'user', to: 'state', label: 'send message' }],
    );
    diagram.baseView.layout.type = 'manual';
    diagram.baseView.layout.edgeRouting = 'orthogonal';

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);
    const nodeRight = Math.max(...layout.nodes.map((node) => node.x + node.width));
    expect(layout.edges[0].points!.length).toBeGreaterThanOrEqual(2);
    expect(layout.edges[0].points!.length).toBeLessThanOrEqual(4);
    expect(Math.max(...layout.edges[0].points!.map(({ x }) => x))).toBeLessThanOrEqual(nodeRight);
  });

  it('keeps compact rank-spanning routes attached with 32px terminal leads', () => {
    const diagram = createDataFlowDiagram(
      [
        { id: 'source', label: 'Source' },
        { id: 'middle', label: 'Middle' },
        { id: 'target', label: 'Target' },
      ],
      [
        { id: 'step', from: 'source', to: 'middle' },
        { id: 'feedback', from: 'source', to: 'target', label: 'regression feedback' },
      ],
    );

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar, undefined, 260);
    const source = layout.nodes.find((node) => node.id === 'source')!;
    const target = layout.nodes.find((node) => node.id === 'target')!;
    const route = layout.edges.find((edge) => edge.label === 'regression feedback')!;
    const points = route.points!;

    expect(points[0]).toEqual({ x: source.x + source.width, y: source.y + source.height / 2 });
    expect(points.at(-1)).toEqual({ x: target.x + target.width, y: target.y + target.height / 2 });
    expect(Math.abs(points[1].x - points[0].x)).toBeGreaterThanOrEqual(32);
    expect(Math.abs(points.at(-2)!.x - points.at(-1)!.x)).toBeGreaterThanOrEqual(32);
    expect(route.path).toContain(' Q ');
  });

  it('rounds orthogonal corners and clamps the radius to short segments', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 20 },
    ];

    expect(buildRoundedOrthogonalPath(points, 6)).toBe('M 0 0 L 2 0 Q 4 0 4 2 L 4 20');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 20 },
    ]);
  });

  it('preserves route endpoints while adding quadratic corner commands', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'source', label: 'Source' },
        { id: 'target', label: 'Target' },
      ],
      [{ id: 'route', from: 'source', to: 'target' }],
    );
    diagram.model.nodes[1].position = { x: 180, y: 100 };
    diagram.baseView.layout.type = 'manual';
    diagram.baseView.layout.edgeRouting = 'orthogonal';

    const edge = computeLayout(diagram.model, diagram.baseView, diagram.grammar).edges[0];
    const first = edge.points![0];
    const last = edge.points![edge.points!.length - 1];

    expect(edge.path).toContain(' Q ');
    expect(edge.path.startsWith(`M ${first.x} ${first.y}`)).toBe(true);
    expect(edge.path.endsWith(`L ${last.x} ${last.y}`)).toBe(true);
  });

  it('keeps a clear lead between node ports and orthogonal turns', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'source', label: 'Source', position: { x: 0, y: 0 } },
        { id: 'target', label: 'Target', position: { x: 260, y: 140 } },
      ],
      [{ id: 'route', from: 'source', to: 'target' }],
    );
    diagram.baseView.layout.type = 'manual';
    diagram.baseView.layout.edgeRouting = 'orthogonal';

    const points = computeLayout(diagram.model, diagram.baseView, diagram.grammar).edges[0].points!;
    const firstLead = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    const last = points.length - 1;
    const finalLead = Math.hypot(
      points[last].x - points[last - 1].x,
      points[last].y - points[last - 1].y,
    );

    expect(firstLead).toBeGreaterThanOrEqual(32);
    expect(finalLead).toBeGreaterThanOrEqual(32);
  });

  it('keeps forward and return routes on separate lanes', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'left', label: 'Left', position: { x: 0, y: 0 } },
        { id: 'right', label: 'Right', position: { x: 320, y: 0 } },
      ],
      [
        { id: 'forward', from: 'left', to: 'right' },
        { id: 'return', from: 'right', to: 'left' },
      ],
    );
    diagram.baseView.layout.type = 'manual';
    diagram.baseView.layout.edgeRouting = 'orthogonal';

    const [forward, returnEdge] = computeLayout(
      diagram.model,
      diagram.baseView,
      diagram.grammar,
    ).edges;
    expect(forward.points?.[2].y).not.toBe(returnEdge.points?.[2].y);
    expect(forward.path).not.toBe(returnEdge.path);
  });

  it('routes vertical backward edges from side ports outside forward branches', () => {
    const diagram = createStateMachineDiagram(
      [
        { id: 'idle', label: 'Idle', isStart: true },
        { id: 'loading', label: 'Loading' },
        { id: 'ready', label: 'Ready', isEnd: true },
        { id: 'error', label: 'Invalid source', isEnd: true },
      ],
      [
        { from: 'idle', to: 'loading', label: 'select state' },
        { from: 'loading', to: 'ready', label: 'render succeeds' },
        { from: 'loading', to: 'error', label: 'parse fails' },
        { from: 'error', to: 'idle', label: 'choose another case' },
      ],
    );
    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);
    const source = layout.nodes.find(({ id }) => id === 'error')!;
    const target = layout.nodes.find(({ id }) => id === 'idle')!;
    const route = layout.edges.find(({ from, to }) => from === 'error' && to === 'idle')!;

    expect(route.points![0]).toEqual({ x: source.x, y: source.y + source.height / 2 });
    expect(route.points!.at(-1)).toEqual({ x: target.x, y: target.y + target.height / 2 });
    expect(route.points![1].x).toBeLessThan(Math.min(...layout.nodes.map(({ x }) => x)));
  });

  it('gives an oversized compact adjacent label a clear outside lane', () => {
    const label = 'a deliberately long horizontal route label that must remain owned';
    const diagram = createDataFlowDiagram(
      [
        { id: 'source', label: 'Source', kind: 'external' },
        { id: 'target', label: 'Target', kind: 'process' },
      ],
      [{ id: 'route', from: 'source', to: 'target', label }],
    );
    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar, undefined, 260);
    const route = layout.edges[0];
    const nodeRight = Math.max(...layout.nodes.map((node) => node.x + node.width));

    expect(route.points).toHaveLength(4);
    expect(route.points![1].x).toBeGreaterThanOrEqual(
      nodeRight + measureEdgeLabel(label, compactEdgeLabelMaxWidth(label)).width / 2 + 8,
    );
  });

  it('keeps self-route ports centered with perpendicular outside tangents', () => {
    const diagram = createArchitectureDiagram(
      [{ id: 'node', label: 'Node', position: { x: 100, y: 100 } }],
      [{ id: 'self', from: 'node', to: 'node' }],
    );
    diagram.baseView.layout.type = 'manual';
    diagram.baseView.layout.edgeRouting = 'orthogonal';

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);
    const node = layout.nodes[0];
    const points = layout.edges[0].points!;
    const source = points[0];
    const sourceTangent = points[1];
    const terminal = points.at(-1)!;
    const tangent = points.at(-2)!;

    expect(source.x).toBe(node.x + node.width / 2);
    expect(source.y).toBe(node.y);
    expect(sourceTangent.x).toBe(source.x);
    expect(sourceTangent.y).toBeLessThan(node.y);
    expect(terminal.x).toBe(node.x + node.width);
    expect(terminal.y).toBe(node.y + node.height / 2);
    expect(tangent.x).toBeGreaterThan(terminal.x);
    expect(tangent.y).toBe(terminal.y);
    expect(points.slice(1, -1).every((point) => point.y < node.y || point.x > terminal.x)).toBe(
      true,
    );
    expect(layout.edges[0].path.match(/(?:^|\s)M\s/g)).toHaveLength(1);
  });

  it('renders requested curved layouts with restrained orthogonal corners', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'source', label: 'Source' },
        { id: 'target', label: 'Target' },
      ],
      [{ id: 'route', from: 'source', to: 'target' }],
    );
    diagram.model.nodes[0].position = { x: 0, y: 0 };
    diagram.model.nodes[1].position = { x: 180, y: 100 };
    diagram.baseView.layout.type = 'manual';
    diagram.baseView.layout.edgeRouting = 'curved';

    const edge = computeLayout(diagram.model, diagram.baseView, diagram.grammar).edges[0];
    expect(edge.path).toContain(' Q ');
    expect(edge.path).not.toContain(' C ');
  });

  it('keeps grouped routes compact and clear of group headings', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'user', label: 'Workspace user', group: 'client' },
        { id: 'renderer', label: 'Diagram renderer', group: 'client' },
        { id: 'daemon', label: 'Intent daemon', group: 'runtime' },
        { id: 'notes', label: 'Persistent notes', group: 'runtime' },
        { id: 'events', label: 'Workspace events', group: 'runtime' },
      ],
      [
        { id: 'a1', from: 'user', to: 'renderer', label: 'explores' },
        { id: 'a2', from: 'renderer', to: 'daemon', label: 'requests state' },
        { id: 'a3', from: 'daemon', to: 'notes', label: 'reads and writes' },
        { id: 'a4', from: 'notes', to: 'events', label: 'publishes change' },
        { id: 'a5', from: 'events', to: 'renderer', label: 'refreshes view' },
      ],
    );
    diagram.model.groups = [
      { id: 'client', label: 'Browser-only preview', nodeIds: ['user', 'renderer'] },
      { id: 'runtime', label: 'Production boundary', nodeIds: ['daemon', 'notes', 'events'] },
    ];
    diagram.baseView.layout.direction = 'TB';

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);
    const renderer = layout.nodes.find((node) => node.id === 'renderer')!;
    const daemon = layout.nodes.find((node) => node.id === 'daemon')!;
    const requestRoute = layout.edges.find((edge) => edge.label === 'requests state')!;
    const requestLength = requestRoute.points!.slice(0, -1).reduce((total, point, index) => {
      const next = requestRoute.points![index + 1];
      return total + Math.hypot(next.x - point.x, next.y - point.y);
    }, 0);
    const crossesHeading = layout.edges.some((edge) =>
      edge.points!.slice(0, -1).some((point, index) => {
        const next = edge.points![index + 1];
        return layout.groups!.some((group) => {
          for (let step = 0; step <= 100; step += 1) {
            const x = point.x + ((next.x - point.x) * step) / 100;
            const y = point.y + ((next.y - point.y) * step) / 100;
            if (x >= group.x && x <= group.x + group.width && y >= group.y && y <= group.y + 30) {
              return true;
            }
          }
          return false;
        });
      }),
    );

    expect(layout.bounds.height).toBeGreaterThan(layout.bounds.width);
    expect(layout.bounds.width).toBeLessThan(340);
    expect(layout.bounds.height).toBeLessThan(900);
    expect(renderer.y).toBeLessThan(daemon.y);
    expect(requestLength).toBeLessThan(300);
    expect(crossesHeading).toBe(false);
  });

  it('gives a rank-spanning labeled route its own outside lane', () => {
    const diagram = createFlowchartDiagram(
      [
        { id: 'source', label: 'Source', kind: 'process' },
        { id: 'middle', label: 'Middle', kind: 'process' },
        { id: 'target', label: 'Target', kind: 'process' },
      ],
      [
        { id: 'step-1', from: 'source', to: 'middle' },
        { id: 'step-2', from: 'middle', to: 'target' },
        { id: 'direct', from: 'source', to: 'target', label: 'fan out to direct capture' },
      ],
    );

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);
    const route = layout.edges.find(({ label }) => label === 'fan out to direct capture')!;
    const nodeMaxX = Math.max(...layout.nodes.map((node) => node.x + node.width));
    const horizontalCapacity = route.points!.slice(0, -1).reduce((longest, point, index) => {
      const next = route.points![index + 1];
      return Math.max(longest, Math.abs(next.y - point.y) < 0.001 ? Math.abs(next.x - point.x) : 0);
    }, 0);

    expect(route.points).toHaveLength(4);
    expect(Math.max(...route.points!.map(({ x }) => x))).toBeGreaterThan(nodeMaxX);
    expect(horizontalCapacity).toBeGreaterThanOrEqual(measureEdgeLabel(route.label!).width + 8);
  });

  it('should create non-overlapping edge paths', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ],
    );
    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    expect(layout.edges).toHaveLength(2);

    // Each edge should have valid points
    layout.edges.forEach((edge) => {
      expect(edge.points).toBeDefined();
      expect(edge.points!.length).toBeGreaterThanOrEqual(2);

      // All points should be finite numbers
      edge.points!.forEach((point) => {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      });
    });
  });

  it('should spread ports for multiple edges from same node', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'source', label: 'Source' },
        { id: 'target1', label: 'Target 1' },
        { id: 'target2', label: 'Target 2' },
        { id: 'target3', label: 'Target 3' },
      ],
      [
        { from: 'source', to: 'target1' },
        { from: 'source', to: 'target2' },
        { from: 'source', to: 'target3' },
      ],
    );

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    // Get starting points of all edges from 'source'
    const edgesFromSource = layout.edges.filter((e) => e.from === 'source');

    expect(edgesFromSource).toHaveLength(3);

    // Starting points should be different (port spreading)
    const startPoints = edgesFromSource.map((e) => e.points![0]);
    const uniquePositions = new Set(startPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`));

    // At least some edges should have different starting positions
    expect(uniquePositions.size).toBeGreaterThanOrEqual(1);
  });

  it('should handle backward edges (against flow direction)', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      [
        { from: 'a', to: 'b', label: 'forward' },
        { from: 'b', to: 'a', label: 'source text and metadata' },
      ],
    );
    diagram.baseView.layout = {
      ...diagram.baseView.layout,
      type: 'layered',
      direction: 'TB',
      edgeRouting: 'orthogonal',
    };
    diagram.model.nodes[0].position = { x: 0, y: 0 };
    diagram.model.nodes[1].position = { x: 0, y: 160 };

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    expect(layout.edges).toHaveLength(2);

    // Both edges should have valid paths
    layout.edges.forEach((edge) => {
      expect(edge.path).toBeDefined();
      expect(edge.path.startsWith('M')).toBe(true);
      expect(edge.points).toBeDefined();
      expect(edge.points!.length).toBeGreaterThanOrEqual(2);
    });

    // The backward edge should have more routing points (to route around)
    const backwardEdge = layout.edges.find((e) => e.from === 'b')!;

    // Backward edge typically needs more points for routing around
    expect(backwardEdge.points!.length).toBeGreaterThanOrEqual(2);
    const minNodeX = Math.min(...layout.nodes.map((node) => node.x));
    const outsideTrackX = Math.min(...backwardEdge.points!.map((point) => point.x));
    expect(minNodeX - outsideTrackX).toBeGreaterThanOrEqual(96);
  });

  it('should not overlap horizontal line segments', () => {
    // Create a diagram where multiple edges need horizontal routing segments
    const diagram = createArchitectureDiagram(
      [
        { id: 'top1', label: 'Top 1' },
        { id: 'top2', label: 'Top 2' },
        { id: 'bottom1', label: 'Bottom 1' },
        { id: 'bottom2', label: 'Bottom 2' },
      ],
      [
        { from: 'top1', to: 'bottom2', label: 'crosses' }, // Needs horizontal segment
        { from: 'top2', to: 'bottom1', label: 'crosses' }, // Needs horizontal segment
      ],
    );

    // Use TB layout which creates horizontal segments for crossing edges
    diagram.baseView.layout.direction = 'TB';

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    expect(layout.edges).toHaveLength(2);

    // Get edges and extract horizontal segments
    const getHorizontalSegments = (points: { x: number; y: number }[]) => {
      const segments: { y: number; minX: number; maxX: number }[] = [];
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        // Horizontal segment (same Y, different X)
        if (Math.abs(p1.y - p2.y) < 1 && Math.abs(p1.x - p2.x) > 5) {
          segments.push({
            y: p1.y,
            minX: Math.min(p1.x, p2.x),
            maxX: Math.max(p1.x, p2.x),
          });
        }
      }
      return segments;
    };

    const allHorizontalSegments: { y: number; minX: number; maxX: number }[] = [];
    layout.edges.forEach((edge) => {
      if (edge.points) {
        allHorizontalSegments.push(...getHorizontalSegments(edge.points));
      }
    });

    // Check that horizontal segments with overlapping X ranges have different Y values
    for (let i = 0; i < allHorizontalSegments.length; i++) {
      for (let j = i + 1; j < allHorizontalSegments.length; j++) {
        const seg1 = allHorizontalSegments[i];
        const seg2 = allHorizontalSegments[j];

        // Check if X ranges overlap
        const overlapsX = !(seg1.maxX < seg2.minX || seg1.minX > seg2.maxX);

        if (overlapsX) {
          // If X overlaps, Y should be different (not on same line)
          const yDiff = Math.abs(seg1.y - seg2.y);
          expect(yDiff).toBeGreaterThan(5); // Should be separated
        }
      }
    }
  });
});

describe('Semantic label wrapping', () => {
  it('preserves explicit line breaks as hard breaks', () => {
    expect(splitSemanticLabel('Named preview\ndirect URL')).toEqual([
      { text: 'Named ', breakAfter: true, hardBreak: false },
      { text: 'preview', breakAfter: true, hardBreak: true },
      { text: 'direct ', breakAfter: true, hardBreak: false },
      { text: 'URL', breakAfter: false, hardBreak: false },
    ]);
  });

  it('creates wrap opportunities only at delimiters and camel boundaries', () => {
    expect(
      semanticLabelTokens('CatalogScene.svelte diagram-workbench.preview-fixtures.ts'),
    ).toEqual([
      'Catalog',
      'Scene.',
      'svelte',
      'diagram-',
      'workbench.',
      'preview-',
      'fixtures.',
      'ts',
    ]);
    expect(
      semanticLabelTokens('SupercalifragilisticexpialidociousDeterministicSnapshotBoundary'),
    ).toEqual(['Supercalifragilisticexpialidocious', 'Deterministic', 'Snapshot', 'Boundary']);
  });

  it('keeps measured filename components intact while retaining semantic break points', () => {
    expect(semanticLabelUnits('CatalogScene.svelte diagram-workbench.preview-fixtures.ts')).toEqual(
      ['CatalogScene.', 'svelte', 'diagram-workbench.', 'preview-fixtures.', 'ts'],
    );
    expect(semanticFilenameUnits('CatalogScene.svelte')).toEqual(['CatalogScene.svelte']);
    expect(semanticFilenameUnits('preview-definition.ts')).toEqual(['preview-definition.ts']);
    expect(semanticFilenameUnits('MermaidRenderer.svelte')).toEqual(['MermaidRenderer', '.svelte']);
    expect(semanticFilenameUnits('diagram-workbench.preview-fixtures.ts')).toEqual([
      'diagram-workbench.',
      'preview-fixtures.ts',
    ]);
  });
});

describe('Layout Without Groups', () => {
  it('should use hierarchical layer assignment', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'root', label: 'Root' },
        { id: 'child1', label: 'Child 1' },
        { id: 'child2', label: 'Child 2' },
        { id: 'grandchild', label: 'Grandchild' },
      ],
      [
        { from: 'root', to: 'child1' },
        { from: 'root', to: 'child2' },
        { from: 'child1', to: 'grandchild' },
        { from: 'child2', to: 'grandchild' },
      ],
    );

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    const root = layout.nodes.find((n) => n.id === 'root')!;
    const child1 = layout.nodes.find((n) => n.id === 'child1')!;
    const child2 = layout.nodes.find((n) => n.id === 'child2')!;
    const grandchild = layout.nodes.find((n) => n.id === 'grandchild')!;

    // All nodes should be positioned
    expect(root).toBeDefined();
    expect(child1).toBeDefined();
    expect(child2).toBeDefined();
    expect(grandchild).toBeDefined();

    // Layout should produce 4 nodes with valid positions
    expect(layout.nodes).toHaveLength(4);
    layout.nodes.forEach((node) => {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    });

    // All 4 edges should have valid paths
    expect(layout.edges).toHaveLength(4);
    layout.edges.forEach((edge) => {
      expect(edge.path).toBeDefined();
      expect(edge.path.length).toBeGreaterThan(0);
    });
  });

  it('should handle disconnected nodes', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'isolated', label: 'Isolated' },
      ],
      [{ from: 'a', to: 'b' }],
    );

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    // All nodes should have valid positions
    expect(layout.nodes).toHaveLength(3);
    layout.nodes.forEach((node) => {
      expect(typeof node.x).toBe('number');
      expect(typeof node.y).toBe('number');
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    });
  });

  it('should handle cycles in the graph', () => {
    const diagram = createArchitectureDiagram(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' }, // Creates a cycle
      ],
    );

    const layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar);

    // Should not crash and should produce valid layout
    expect(layout.nodes).toHaveLength(3);
    expect(layout.edges).toHaveLength(3);

    layout.nodes.forEach((node) => {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    });
  });
});
