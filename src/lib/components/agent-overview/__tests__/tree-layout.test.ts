/**
 * Tests for the Tree Layout Engine
 *
 * Tests the Reingold-Tilford algorithm implementation for hierarchical tree layouts.
 */
import { describe, it, expect } from 'vitest';
import {
  computeTreeLayout,
  type HierarchyNode,
  type LayoutNode,
  DEFAULT_LAYOUT_CONFIG,
} from '../tree-layout';
import type { AgentNode, FileNode } from '../types';

// Helper to create a mock agent node
function createMockAgent(id: string, name: string, parentId?: string): AgentNode {
  return {
    id: `agent-${id}`,
    type: 'agent',
    agentId: id,
    name,
    isCoordinator: !parentId,
    status: 'idle',
    specialist: null,
    parentAgentId: parentId || null,
    createdAt: new Date().toISOString(),
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  };
}

// Helper to create a hierarchy node
function createHierarchyNode(
  agent: AgentNode,
  children: HierarchyNode[] = [],
  files: FileNode[] = [],
): HierarchyNode {
  return { agent, children, files };
}

describe('Tree Layout Engine', () => {
  describe('computeTreeLayout', () => {
    it('should return null-like result for empty input', () => {
      const result = computeTreeLayout([]);
      expect(result.roots).toHaveLength(0);
    });

    it('should layout a single root node correctly', () => {
      const agent = createMockAgent('1', 'Root Agent');
      const root = createHierarchyNode(agent);

      const result = computeTreeLayout([root]);

      expect(result.roots).toHaveLength(1);
      expect(result.roots[0].y).toBe(0); // Root should be at y=0
      expect(result.height).toBeGreaterThan(0);
      expect(result.width).toBeGreaterThan(0);
    });

    it('should center parent over single child', () => {
      const parent = createMockAgent('1', 'Parent');
      const child = createMockAgent('2', 'Child', '1');

      const root = createHierarchyNode(parent, [createHierarchyNode(child)]);

      const result = computeTreeLayout([root]);

      const parentNode = result.roots[0];
      const childNode = parentNode.layoutChildren[0];

      // Parent should be centered over child (same x position)
      expect(parentNode.x).toBe(childNode.x);
    });

    it('should center parent over multiple children', () => {
      const parent = createMockAgent('1', 'Parent');
      const child1 = createMockAgent('2', 'Child 1', '1');
      const child2 = createMockAgent('3', 'Child 2', '1');

      const root = createHierarchyNode(parent, [
        createHierarchyNode(child1),
        createHierarchyNode(child2),
      ]);

      const result = computeTreeLayout([root]);

      const parentNode = result.roots[0];
      const childNodes = parentNode.layoutChildren;

      // Parent x should be midpoint of children
      const childMidpoint = (childNodes[0].x + childNodes[1].x) / 2;
      expect(parentNode.x).toBeCloseTo(childMidpoint, 0);
    });

    it('should place children at correct vertical level', () => {
      const config = { levelSpacing: 100, nodeHeight: 50 };
      const parent = createMockAgent('1', 'Parent');
      const child = createMockAgent('2', 'Child', '1');

      const root = createHierarchyNode(parent, [createHierarchyNode(child)]);

      const result = computeTreeLayout([root], config);

      const parentNode = result.roots[0];
      const childNode = parentNode.layoutChildren[0];

      // Child y should be parent y + levelSpacing + nodeHeight
      expect(childNode.y).toBe(parentNode.y + config.levelSpacing + config.nodeHeight);
    });

    it('should space siblings appropriately', () => {
      const config = { siblingSpacing: 50, nodeWidth: 100 };
      const parent = createMockAgent('1', 'Parent');
      const child1 = createMockAgent('2', 'Child 1', '1');
      const child2 = createMockAgent('3', 'Child 2', '1');
      const child3 = createMockAgent('4', 'Child 3', '1');

      const root = createHierarchyNode(parent, [
        createHierarchyNode(child1),
        createHierarchyNode(child2),
        createHierarchyNode(child3),
      ]);

      const result = computeTreeLayout([root], config);

      const children = result.roots[0].layoutChildren;

      // Children should not overlap
      for (let i = 1; i < children.length; i++) {
        const gap = children[i].x - children[i - 1].x;
        expect(gap).toBeGreaterThanOrEqual(config.nodeWidth + config.siblingSpacing);
      }
    });

    it('should handle deep trees', () => {
      // Create a chain: A -> B -> C -> D
      const agents = ['A', 'B', 'C', 'D'].map((name, i) =>
        createMockAgent(String(i), name, i > 0 ? String(i - 1) : undefined),
      );

      let current = createHierarchyNode(agents[3]);
      for (let i = 2; i >= 0; i--) {
        current = createHierarchyNode(agents[i], [current]);
      }

      const result = computeTreeLayout([current]);

      expect(result.roots).toHaveLength(1);

      // Check depth increases
      let node: LayoutNode | undefined = result.roots[0];
      let lastY = -1;
      while (node) {
        expect(node.y).toBeGreaterThan(lastY);
        lastY = node.y;
        node = node.layoutChildren[0];
      }
    });

    it('should group children when exceeding threshold', () => {
      const config = { maxChildrenBeforeGroup: 3 };
      const parent = createMockAgent('1', 'Parent');
      const children = [1, 2, 3, 4, 5].map((i) =>
        createMockAgent(String(i + 1), `Child ${i}`, '1'),
      );

      const root = createHierarchyNode(
        parent,
        children.map((c) => createHierarchyNode(c)),
      );

      const result = computeTreeLayout([root], config);

      // Parent should be marked as grouped
      expect(result.roots[0].isGrouped).toBe(true);
      // Layout children should be empty (children rendered differently when grouped)
      expect(result.roots[0].layoutChildren).toHaveLength(0);
      // Original children should still be accessible
      expect(result.roots[0].children).toHaveLength(5);
    });

    it('should handle multiple root trees', () => {
      const root1 = createHierarchyNode(createMockAgent('1', 'Root 1'));
      const root2 = createHierarchyNode(createMockAgent('2', 'Root 2'));

      const result = computeTreeLayout([root1, root2]);

      expect(result.roots).toHaveLength(2);
      // Roots should not overlap
      expect(result.roots[0].x).not.toBe(result.roots[1].x);
    });

    it('should prevent subtree overlap', () => {
      // Create a tree where left child has deep subtree
      //       P
      //      / \
      //     A   B
      //    / \
      //   C   D
      const P = createMockAgent('P', 'Parent');
      const A = createMockAgent('A', 'A', 'P');
      const B = createMockAgent('B', 'B', 'P');
      const C = createMockAgent('C', 'C', 'A');
      const D = createMockAgent('D', 'D', 'A');

      const root = createHierarchyNode(P, [
        createHierarchyNode(A, [createHierarchyNode(C), createHierarchyNode(D)]),
        createHierarchyNode(B),
      ]);

      const result = computeTreeLayout([root]);
      const config = DEFAULT_LAYOUT_CONFIG;

      // Find all nodes
      const allNodes: LayoutNode[] = [];
      function traverse(node: LayoutNode) {
        allNodes.push(node);
        node.layoutChildren.forEach(traverse);
      }
      result.roots.forEach(traverse);

      // Check no nodes at same level overlap
      const byLevel = new Map<number, LayoutNode[]>();
      for (const node of allNodes) {
        if (!byLevel.has(node.y)) byLevel.set(node.y, []);
        byLevel.get(node.y)!.push(node);
      }

      for (const [, nodes] of byLevel) {
        nodes.sort((a, b) => a.x - b.x);
        for (let i = 1; i < nodes.length; i++) {
          const gap = nodes[i].x - nodes[i - 1].x;
          expect(gap).toBeGreaterThanOrEqual(config.nodeWidth);
        }
      }
    });
  });
});
