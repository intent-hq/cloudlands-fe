import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(resolve(__dirname, '+page.svelte'), 'utf8');
const surfaceSource = readFileSync(resolve(__dirname, 'WorkspaceSurface.svelte'), 'utf8');
const rootLayoutSource = readFileSync(resolve(process.cwd(), 'src/routes/+layout.svelte'), 'utf8');

describe('workspace route context installation', () => {
  it('keys the workspace page by page.params.id', () => {
    expect(pageSource).toContain('page.params?.id');
    expect(pageSource).toContain('{#key routeWorkspaceId}');
    expect(pageSource).toContain('<WorkspaceSurface {workspaceId} />');
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

  it('retains workspace-scoped Redux data for persistent column surfaces', () => {
    expect(surfaceSource).toContain('retainWorkspaceSessionOnUnmount?: boolean');
    expect(surfaceSource).toContain('if (workspaceId && !retainWorkspaceSessionOnUnmount)');
    expect(surfaceSource).toContain('if (!retainWorkspaceSessionOnUnmount)');
  });
});
