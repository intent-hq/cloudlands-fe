import { render, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import RetentionHarness from './RetainedWorkspaceSurfaces.test.svelte';
import {
  createWorkspaceSurfaceRetentionState,
  reconcileWorkspaceSurfaces,
} from './workspace-surface-retention';

const workspaceIds = ['workspace-a', 'workspace-b', 'workspace-c', 'workspace-d', 'workspace-e'];

describe('workspace surface retention', () => {
  it('retains A through A → B → A without mounting unvisited workspaces', () => {
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

  it('keeps a four-workspace working set warm and evicts by most recent activation', () => {
    let state = createWorkspaceSurfaceRetentionState();
    state = reconcileWorkspaceSurfaces(state, input('workspace-a'));
    const initialGeneration = generation(state, 'workspace-a');
    state = reconcileWorkspaceSurfaces(state, input('workspace-b'));
    const evictedGeneration = generation(state, 'workspace-b');
    state = reconcileWorkspaceSurfaces(state, input('workspace-c'));
    state = reconcileWorkspaceSurfaces(state, input('workspace-d'));
    expect(state.surfaces).toHaveLength(4);

    state = reconcileWorkspaceSurfaces(state, input('workspace-a'));
    expect(generation(state, 'workspace-a')).toBe(initialGeneration);
    state = reconcileWorkspaceSurfaces(state, input('workspace-e'));
    expect(state.surfaces.map(({ workspaceId }) => workspaceId)).toEqual([
      'workspace-a',
      'workspace-c',
      'workspace-d',
      'workspace-e',
    ]);

    state = reconcileWorkspaceSurfaces(state, input('workspace-b'));
    expect(state.surfaces).toHaveLength(4);
    expect(generation(state, 'workspace-b')).not.toBe(evictedGeneration);
    expect(state.surfaces.some(({ workspaceId }) => workspaceId === 'workspace-c')).toBe(false);
  });

  it('does not churn state when the same workspace remains active', () => {
    const state = reconcileWorkspaceSurfaces(
      createWorkspaceSurfaceRetentionState(),
      input('workspace-a'),
    );
    expect(reconcileWorkspaceSurfaces(state, input('workspace-a'))).toBe(state);
  });

  it('preserves the same DOM across repeated multi-workspace switching', async () => {
    const view = render(RetentionHarness, { props: input('workspace-a') });
    const content = new Map<string, HTMLElement>();
    for (const workspaceId of workspaceIds.slice(0, 4)) {
      await view.rerender(input(workspaceId));
      content.set(workspaceId, view.getByRole('button', { name: workspaceId }));
    }

    for (let cycle = 0; cycle < 3; cycle++) {
      for (const workspaceId of workspaceIds.slice(0, 4)) {
        await view.rerender(input(workspaceId));
        expect(view.getByRole('button', { name: workspaceId })).toBe(content.get(workspaceId));
        expect(view.getAllByRole('button')).toHaveLength(1);
        expect(view.container.querySelectorAll('[data-retained-workspace-surface]')).toHaveLength(
          4,
        );
      }
    }

    await view.rerender({ ...input('workspace-d'), openWorkspaceIds: ['workspace-d'] });
    expect(view.container.querySelectorAll('[data-retained-workspace-surface]')).toHaveLength(1);
    expect(view.getByRole('button', { name: 'workspace-d' })).toBe(content.get('workspace-d'));
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
    expect(inactiveA?.contains(retainedA)).toBe(true);
    expect(inactiveA?.hasAttribute('hidden')).toBe(true);
    expect((inactiveA as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect(inactiveA?.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).not.toBe(retainedA);

    await view.rerender(input('workspace-a'));
    await waitFor(() => expect(inactiveA?.hasAttribute('hidden')).toBe(false));
    expect(view.getByRole('button', { name: 'workspace-a' })).toBe(retainedA);
  });

  it('blurs focus inside the deactivating surface before inert applies', async () => {
    const view = render(RetentionHarness, {
      props: input('workspace-a'),
    });
    await waitFor(() =>
      expect(view.container.querySelectorAll('[data-retained-workspace-surface]')).toHaveLength(1),
    );
    const retainedA = view.getByRole('button', { name: 'workspace-a' });
    const surfaceA = view.container.querySelector<HTMLElement & { inert: boolean }>(
      '[data-retained-workspace-surface="workspace-a"]',
    )!;
    retainedA.focus();
    expect(document.activeElement).toBe(retainedA);
    expect(surfaceA.inert).toBe(false);

    // Flipping `inert` while a descendant holds focus makes the browser blur
    // it synchronously inside the template effect, where widgets that write
    // $state on blur (e.g. TipTap) throw state_unsafe_mutation — so the blur
    // must land before the surface's `inert` attribute updates.
    let surfaceInertAtBlur: boolean | null = null;
    retainedA.addEventListener('blur', () => {
      surfaceInertAtBlur = surfaceA.inert;
    });

    await view.rerender(input('workspace-b'));

    expect(document.activeElement).not.toBe(retainedA);
    expect(surfaceInertAtBlur).toBe(false);
    expect(surfaceA.inert).toBe(true);
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
