import { describe, it, expect } from 'vitest';
import type { Note } from '$shared/types';
import { flattenTaskTree, findReadyTasks } from '../task-tree-utils';

// Helper to create a minimal task note for testing
// Note: Task orchestration now uses parentId hierarchy - children block their parent
function createTaskNote(
  id: string,
  title: string,
  opts: {
    parentId?: string;
    peerOrder?: number;
    createdAt?: string;
    status?: string;
  } = {},
): Note {
  return {
    id,
    title,
    content: '',
    parentId: opts.parentId,
    createdAt: opts.createdAt || '2025-01-01T00:00:00Z',
    updatedAt: opts.createdAt || '2025-01-01T00:00:00Z',
    metadata: {
      task: {
        status: (opts.status as any) || 'not_started',
        peerOrder: opts.peerOrder,
      },
    },
  } as Note;
}

describe('flattenTaskTree', () => {
  it('returns empty array for empty input', () => {
    const result = flattenTaskTree([]);
    expect(result).toEqual([]);
  });

  it('returns single task', () => {
    const notes = [createTaskNote('a', 'Task A')];
    const result = flattenTaskTree(notes);
    expect(result.map((n) => n.id)).toEqual(['a']);
  });

  it('sorts siblings by peerOrder', () => {
    const notes = [
      createTaskNote('c', 'Task C', { peerOrder: 300 }),
      createTaskNote('a', 'Task A', { peerOrder: 100 }),
      createTaskNote('b', 'Task B', { peerOrder: 200 }),
    ];
    const result = flattenTaskTree(notes);
    expect(result.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to createdAt when peerOrder is equal', () => {
    const notes = [
      createTaskNote('c', 'Task C', { peerOrder: 0, createdAt: '2025-01-03T00:00:00Z' }),
      createTaskNote('a', 'Task A', { peerOrder: 0, createdAt: '2025-01-01T00:00:00Z' }),
      createTaskNote('b', 'Task B', { peerOrder: 0, createdAt: '2025-01-02T00:00:00Z' }),
    ];
    const result = flattenTaskTree(notes);
    expect(result.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('flattens parent-child hierarchy in post-order (children first)', () => {
    // Tree:
    //   A (root)
    //   ├── A1
    //   └── A2
    //   B (root)
    // Post-order: children before parents, so A1, A2, A, B
    const notes = [
      createTaskNote('a', 'Task A', { peerOrder: 100 }),
      createTaskNote('a1', 'Task A1', { parentId: 'a', peerOrder: 100 }),
      createTaskNote('a2', 'Task A2', { parentId: 'a', peerOrder: 200 }),
      createTaskNote('b', 'Task B', { peerOrder: 200 }),
    ];
    const result = flattenTaskTree(notes);
    expect(result.map((n) => n.id)).toEqual(['a1', 'a2', 'a', 'b']);
  });

  it('handles deeper nesting (deepest first)', () => {
    // Tree:
    //   A
    //   └── A1
    //       └── A1a
    // Post-order: deepest first, so A1a, A1, A
    const notes = [
      createTaskNote('a', 'Task A', { peerOrder: 100 }),
      createTaskNote('a1', 'Task A1', { parentId: 'a', peerOrder: 100 }),
      createTaskNote('a1a', 'Task A1a', { parentId: 'a1', peerOrder: 100 }),
    ];
    const result = flattenTaskTree(notes);
    expect(result.map((n) => n.id)).toEqual(['a1a', 'a1', 'a']);
  });

  it('excludes terminal tasks (complete, cancelled)', () => {
    const notes = [
      createTaskNote('a', 'Task A', { peerOrder: 100, status: 'not_started' }),
      createTaskNote('b', 'Task B', { peerOrder: 200, status: 'complete' }),
      createTaskNote('c', 'Task C', { peerOrder: 300, status: 'cancelled' }),
      createTaskNote('d', 'Task D', { peerOrder: 400, status: 'in_progress' }),
    ];
    const result = flattenTaskTree(notes);
    expect(result.map((n) => n.id)).toEqual(['a', 'd']);
  });
});

describe('findReadyTasks', () => {
  it('returns empty array for empty input', () => {
    const result = findReadyTasks([], []);
    expect(result).toEqual([]);
  });

  it('returns task with no dependencies and no children', () => {
    const notes = [createTaskNote('a', 'Task A')];
    const flattened = flattenTaskTree(notes);
    const result = findReadyTasks(flattened, notes);
    expect(result.map((n) => n.id)).toEqual(['a']);
  });

  it('returns multiple peer tasks (siblings do not block each other)', () => {
    const notes = [
      createTaskNote('a', 'Task A', { peerOrder: 100 }),
      createTaskNote('b', 'Task B', { peerOrder: 200 }),
    ];
    const flattened = flattenTaskTree(notes);
    const result = findReadyTasks(flattened, notes);
    expect(result.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('excludes parent tasks blocked by incomplete children', () => {
    // With parentId-based blocking: children block their parent
    // Parent 'a' has child 'b' which is not complete, so 'a' is blocked
    const notes = [
      createTaskNote('a', 'Parent Task', { peerOrder: 100, status: 'not_started' }),
      createTaskNote('b', 'Child Task', { parentId: 'a', peerOrder: 200, status: 'not_started' }),
    ];
    const flattened = flattenTaskTree(notes);
    const result = findReadyTasks(flattened, notes);
    // Only child 'b' is ready (it has no children), parent 'a' is blocked
    expect(result.map((n) => n.id)).toEqual(['b']);
  });

  it('includes parent tasks when all children are complete', () => {
    // With parentId-based blocking: parent is ready when all children are complete
    const notes = [
      createTaskNote('a', 'Parent Task', { peerOrder: 100, status: 'not_started' }),
      createTaskNote('b', 'Child Task', { parentId: 'a', peerOrder: 200, status: 'complete' }),
    ];
    const flattened = flattenTaskTree(notes);
    const result = findReadyTasks(flattened, notes);
    // Parent 'a' is now ready since child 'b' is complete
    expect(result.map((n) => n.id)).toEqual(['a']);
  });

  it('excludes terminal tasks from results', () => {
    const notes = [
      createTaskNote('a', 'Task A', { status: 'complete' }),
      createTaskNote('b', 'Task B', { status: 'cancelled' }),
    ];
    const flattened = flattenTaskTree(notes);
    const result = findReadyTasks(flattened, notes);
    expect(result).toEqual([]);
  });

  it('excludes parent tasks that have incomplete children', () => {
    // Spec has Phase1, Phase2, Phase3 as children
    // Phase1 has Phase1.1 and Phase1.2 as children
    // Only leaf tasks (Phase1.1, Phase1.2, Phase2, Phase3) should be ready
    const notes = [
      createTaskNote('spec', 'Spec', { peerOrder: 100 }),
      createTaskNote('phase1', 'Phase 1', { parentId: 'spec', peerOrder: 100 }),
      createTaskNote('phase1-1', 'Phase 1.1', { parentId: 'phase1', peerOrder: 100 }),
      createTaskNote('phase1-2', 'Phase 1.2', { parentId: 'phase1', peerOrder: 200 }),
      createTaskNote('phase2', 'Phase 2', { parentId: 'spec', peerOrder: 200 }),
      createTaskNote('phase3', 'Phase 3', { parentId: 'spec', peerOrder: 300 }),
    ];
    const flattened = flattenTaskTree(notes);
    const result = findReadyTasks(flattened, notes);
    // Children are ready, but parents (Phase1, Spec) are blocked
    expect(result.map((n) => n.id)).toEqual(['phase1-1', 'phase1-2', 'phase2', 'phase3']);
  });

  it('includes parent task when all children are complete', () => {
    const notes = [
      createTaskNote('parent', 'Parent', { peerOrder: 100 }),
      createTaskNote('child1', 'Child 1', {
        parentId: 'parent',
        peerOrder: 100,
        status: 'complete',
      }),
      createTaskNote('child2', 'Child 2', {
        parentId: 'parent',
        peerOrder: 200,
        status: 'complete',
      }),
    ];
    const flattened = flattenTaskTree(notes);
    const result = findReadyTasks(flattened, notes);
    // Parent is ready because all children are complete
    expect(result.map((n) => n.id)).toEqual(['parent']);
  });

  it('handles mixed complete and incomplete children', () => {
    const notes = [
      createTaskNote('parent', 'Parent', { peerOrder: 100 }),
      createTaskNote('child1', 'Child 1', {
        parentId: 'parent',
        peerOrder: 100,
        status: 'complete',
      }),
      createTaskNote('child2', 'Child 2', {
        parentId: 'parent',
        peerOrder: 200,
        status: 'not_started',
      }),
    ];
    const flattened = flattenTaskTree(notes);
    const result = findReadyTasks(flattened, notes);
    // Only incomplete child is ready; parent is blocked
    expect(result.map((n) => n.id)).toEqual(['child2']);
  });
});
