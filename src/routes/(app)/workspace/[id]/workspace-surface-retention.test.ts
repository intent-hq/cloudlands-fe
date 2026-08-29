import { render, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import RetentionHarness from './RetainedWorkspaceSurfaces.test.svelte';
import {
  createWorkspaceSurfaceRetentionState,
  reconcileWorkspaceSurfaces,
} from './workspace-surface-retention';

const workspaceIds = ['workspace-a', 'workspace-b', 'workspace-c'];

describe('workspace surface retention', () => {
  it('retains A through A → B → A while bounding the live surfaces to two', () => {
    let state = createWorkspaceSurfaceRetentionState();
    state = reconcileWorkspaceSurfaces(state, input('workspace-a'));
    const initialGeneration = generation(state, 'workspace-a');

    state = reconcileWorkspaceSurfaces(state, input('workspace-b'));
    expect(state.surfaces.map(({ workspaceId }) => workspaceId)).toEqual([
      'workspace-a',
      'workspace-b',
    ]);

    state = reconcileWorkspaceSurfaces(state, input('workspace-a'));
    expect(state.surfaces).toHaveLength(2);
    expect(generation(state, 'workspace-a')).toBe(initialGeneration);
  });

  it('evicts the least recently active surface and remounts it on a cold return', () => {
    let state = createWorkspaceSurfaceRetentionState();
    state = reconcileWorkspaceSurfaces(state, input('workspace-a'));
    const initialGeneration = generation(state, 'workspace-a');
    state = reconcileWorkspaceSurfaces(state, input('workspace-b'));
    state = reconcileWorkspaceSurfaces(state, input('workspace-c'));

    expect(state.surfaces.map(({ workspaceId }) => workspaceId)).toEqual([
      'workspace-b',
      'workspace-c',
    ]);

    state = reconcileWorkspaceSurfaces(state, input('workspace-a'));
    expect(state.surfaces).toHaveLength(2);
    expect(generation(state, 'workspace-a')).not.toBe(initialGeneration);
  });

  it('releases closed and deleted inactive surfaces and renews an evicted active surface', () => {
    let state = createWorkspaceSurfaceRetentionState();
    state = reconcileWorkspaceSurfaces(state, input('workspace-a'));
    state = reconcileWorkspaceSurfaces(state, input('workspace-b'));

    state = reconcileWorkspaceSurfaces(state, {
      ...input('workspace-b'),
      openWorkspaceIds: ['workspace-b'],
    });
    expect(state.surfaces.map(({ workspaceId }) => workspaceId)).toEqual(['workspace-b']);

    state = reconcileWorkspaceSurfaces(state, input('workspace-a'));
    state = reconcileWorkspaceSurfaces(state, input('workspace-b'));
    state = reconcileWorkspaceSurfaces(state, {
      ...input('workspace-b'),
      workspaceEntityIds: ['workspace-b', 'workspace-c'],
    });
    expect(state.surfaces.map(({ workspaceId }) => workspaceId)).toEqual(['workspace-b']);

    const beforeEviction = generation(state, 'workspace-b');
    state = reconcileWorkspaceSurfaces(state, {
      ...input('workspace-b'),
      workspaceEntityIds: ['workspace-a', 'workspace-c'],
    });
    expect(generation(state, 'workspace-b')).not.toBe(beforeEviction);
  });

  it('keeps the creation surface instance through its real-ID handoff', () => {
    let state = createWorkspaceSurfaceRetentionState();
    state = reconcileWorkspaceSurfaces(state, input('new'));
    const generationBeforeHandoff = generation(state, 'new');
    state = reconcileWorkspaceSurfaces(state, input('optimistic-workspace-a'));
    expect(generation(state, 'optimistic-workspace-a')).toBe(generationBeforeHandoff);
    state = reconcileWorkspaceSurfaces(state, input('workspace-a'));
    expect(generation(state, 'workspace-a')).toBe(generationBeforeHandoff);
  });

  it('drops a creation surface instead of duplicating an already-retained destination', () => {
    let state = createWorkspaceSurfaceRetentionState();
    state = reconcileWorkspaceSurfaces(state, input('workspace-a'));
    const retainedGeneration = generation(state, 'workspace-a');
    state = reconcileWorkspaceSurfaces(state, input('new'));
    state = reconcileWorkspaceSurfaces(state, input('workspace-a'));

    expect(state.surfaces.map(({ workspaceId }) => workspaceId)).toEqual(['workspace-a']);
    expect(generation(state, 'workspace-a')).toBe(retainedGeneration);
  });

  it('hides and inerts inactive content, releases focus, and preserves the retained DOM', async () => {
    const view = render(RetentionHarness, {
      props: input('workspace-a'),
    });
    await waitFor(() =>
      expect(view.container.querySelectorAll('[data-retained-workspace-surface]')).toHaveLength(1),
    );
    const retainedA = view.getByRole('button', { name: 'workspace-a' });
    retainedA.focus();

    await view.rerender(input('workspace-b'));
    await waitFor(() =>
      expect(view.container.querySelectorAll('[data-retained-workspace-surface]')).toHaveLength(2),
    );
    const inactiveA = view.container.querySelector<HTMLElement>(
      '[data-retained-workspace-surface="workspace-a"]',
    );
    expect(inactiveA).toBe(retainedA.parentElement);
    expect(inactiveA?.hasAttribute('hidden')).toBe(true);
    expect((inactiveA as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect(inactiveA?.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).not.toBe(retainedA);

    await view.rerender(input('workspace-a'));
    await waitFor(() => expect(retainedA.parentElement?.hasAttribute('hidden')).toBe(false));
    expect(view.getByRole('button', { name: 'workspace-a' })).toBe(retainedA);
  });
});

function input(activeWorkspaceId: string) {
  return {
    activeWorkspaceId,
    openWorkspaceIds: workspaceIds,
    workspaceEntityIds: workspaceIds,
  };
}

function generation(
  state: ReturnType<typeof createWorkspaceSurfaceRetentionState>,
  workspaceId: string,
): number {
  const surface = state.surfaces.find((candidate) => candidate.workspaceId === workspaceId);
  if (!surface) throw new Error(`Missing retained surface for ${workspaceId}`);
  return surface.generation;
}
