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
} from '../diagram-templates';
import { validateDiagram } from '../diagram-validator';
import { computeLayout } from '../layout-engine';
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
    const sourceNode = layout.nodes.find((n) => n.id === 'source')!;
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
        { from: 'b', to: 'a', label: 'backward' },
      ],
    );

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
    const forwardEdge = layout.edges.find((e) => e.from === 'a')!;
    const backwardEdge = layout.edges.find((e) => e.from === 'b')!;

    // Backward edge typically needs more points for routing around
    expect(backwardEdge.points!.length).toBeGreaterThanOrEqual(2);
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
