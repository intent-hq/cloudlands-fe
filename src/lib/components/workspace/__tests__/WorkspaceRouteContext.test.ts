/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceId } from '$shared/types/branded-ids';
import * as workspaceRouteContext from '$lib/utils/workspace-route-context';
import WorkspaceRouteContextHarness from './WorkspaceRouteContextHarness.test.svelte';
import WorkspaceRouteContextRouteHarness from './WorkspaceRouteContextRouteHarness.test.svelte';

describe('WorkspaceRouteContextProvider', () => {
  afterEach(() => cleanup());

  it('provides an immutable context from an explicit ID outside a route context', () => {
    render(WorkspaceRouteContextHarness, { props: { workspaceId: WorkspaceId('workspace-a') } });

    expect(screen.getByTestId('workspace-route-id').textContent).toBe('workspace-a');
    expect(screen.getByTestId('workspace-route-context-frozen').textContent).toBe('true');
    expect('setWorkspaceRouteContext' in workspaceRouteContext).toBe(false);
  });

  it('does not expose a concrete ID for the new workspace route', () => {
    render(WorkspaceRouteContextHarness, { props: { workspaceId: null } });

    expect(screen.getByTestId('workspace-route-id').textContent).toBe('none');
    expect(workspaceRouteContext.workspaceIdFromRouteParam('new')).toBeNull();
  });

  it('replaces the provider subtree when the route workspace changes', async () => {
    const view = render(WorkspaceRouteContextHarness, {
      props: { workspaceId: WorkspaceId('workspace-a') },
    });

    await view.rerender({ workspaceId: WorkspaceId('workspace-b') });

    expect(screen.getByTestId('workspace-route-id').textContent).toBe('workspace-b');
  });

  it('clears workspace context when navigating from a workspace to an agent route', async () => {
    const view = render(WorkspaceRouteContextRouteHarness, {
      props: { pathname: '/workspace/workspace-a', routeParam: 'workspace-a' },
    });

    expect(screen.getByTestId('workspace-route-id').textContent).toBe('workspace-a');

    await view.rerender({ pathname: '/agent/workspace-a', routeParam: 'workspace-a' });

    expect(screen.getByTestId('workspace-route-id').textContent).toBe('none');
    expect(workspaceRouteContext.workspaceIdFromRoute('/settings', undefined)).toBeNull();
  });
});
