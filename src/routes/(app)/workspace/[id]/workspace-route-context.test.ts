import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(resolve(__dirname, '+page.svelte'), 'utf8');
const surfaceSource = readFileSync(resolve(__dirname, 'WorkspaceSurface.svelte'), 'utf8');
const rootLayoutSource = readFileSync(resolve(process.cwd(), 'src/routes/+layout.svelte'), 'utf8');

describe('workspace route context installation', () => {
  it('keeps the workspace surface mounted when page.params.id changes', () => {
    expect(pageSource).toContain('page.params?.id');
    expect(pageSource).toContain('<WorkspaceSurface {workspaceId} />');
    expect(pageSource).not.toContain('{#key routeWorkspaceId}');
    expect(pageSource).not.toContain('window.location.pathname');
  });

  it('leaves route context ownership to each workspace surface', () => {
    expect(rootLayoutSource).not.toContain('WorkspaceRouteContextProvider');
    expect(rootLayoutSource).not.toContain('workspaceIdFromRoute');
    expect(surfaceSource).toContain('WorkspaceRouteContextProvider');
    expect(surfaceSource).toContain(
      '<WorkspaceRouteContextProvider workspaceId={surfaceWorkspaceId}>',
    );
    expect(surfaceSource).toContain('{#key surfaceWorkspaceId}');
  });

  it('leaves workspace session cleanup to open-tab removal', () => {
    expect(surfaceSource).not.toContain('workspaceUnmounted');
    expect(surfaceSource).not.toContain('setAgents(workspaceId, [])');
    expect(surfaceSource).not.toContain('setAgentsLoaded(workspaceId, false)');
    expect(surfaceSource).not.toContain('retainWorkspaceSessionOnUnmount');
  });
});
