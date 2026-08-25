import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(import.meta.dirname, '../../..');

describe('workspace surface layout contract', () => {
  it('uses the domain workspace ID as the canonical panel layout key', () => {
    const surface = fs.readFileSync(
      path.join(SRC_ROOT, 'routes/(app)/workspace/[id]/WorkspaceSurface.svelte'),
      'utf8',
    );
    expect(surface).toContain('const panelLayoutId = $derived(workspaceId);');
    expect(surface).not.toContain('getWorkspaceColumnLayoutId');
  });

  it('scopes each surface context to its explicit workspace ID and remounts on switches', () => {
    const surface = fs.readFileSync(
      path.join(SRC_ROOT, 'routes/(app)/workspace/[id]/WorkspaceSurface.svelte'),
      'utf8',
    );
    expect(surface).toContain('WorkspaceRouteContextProvider');
    expect(surface).toContain('const surfaceWorkspaceId = $derived(');
    expect(surface).toContain('{#key surfaceWorkspaceId}');
    expect(surface).toContain('<WorkspaceRouteContextProvider workspaceId={surfaceWorkspaceId}>');
    expect(surface).not.toContain('window.location.pathname');
  });
});
