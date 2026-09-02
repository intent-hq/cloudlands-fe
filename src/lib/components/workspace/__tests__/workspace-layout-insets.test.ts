import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceLayout = readFileSync(
  resolve(process.cwd(), 'src/lib/components/workspace/WorkspaceLayout.svelte'),
  'utf8',
);
const workspaceSurface = readFileSync(
  resolve(process.cwd(), 'src/routes/(app)/workspace/[id]/WorkspaceSurface.svelte'),
  'utf8',
);

describe('WorkspaceLayout panel insets', () => {
  it('preserves the outer leading inset when the sidebar is on the right', () => {
    const rightBranch = workspaceLayout.match(
      /\{#if sidebarSide === 'right'\}([\s\S]*?)\{\/if\}/,
    )?.[1];
    const leftBranch = workspaceLayout.match(
      /\{#if sidebarSide === 'left'\}([\s\S]*?)\{\/if\}/,
    )?.[1];

    expect(rightBranch).toContain('main-content-area flex h-full min-w-0 z-10 bg-sidebar');
    expect(rightBranch).toContain('bg-sidebar pl-2 sm:pl-3');
    expect(leftBranch).toContain('main-content-area flex h-full min-w-0 z-10');
    expect(leftBranch).not.toContain('bg-sidebar pl-2 sm:pl-3');
  });

  it('matches the responsive outer gutter beside a collapsed left sidebar', () => {
    const leftBranch = workspaceLayout.match(
      /\{#if sidebarSide === 'left'\}([\s\S]*?)\{\/if\}/,
    )?.[1];

    expect(workspaceLayout).toContain('const sidebarIsCollapsed = selectIsCollapsed();');
    expect(leftBranch).toMatch(/\{\$sidebarIsCollapsed\s*\?\s*'pl-2 sm:pl-3'\s*:\s*''\}/);
  });

  it('uses only the standard workspace layout contract', () => {
    const workspaceLayoutCall = workspaceSurface.match(/<WorkspaceLayout([\s\S]*?)\/>/)?.[1];

    expect(workspaceLayoutCall).toContain('sidebarSide={$sidebarSide$}');
    expect(workspaceLayout).toContain('maxWidth={sidebarMaxWidth}');
    expect(workspaceLayout).toContain('defaultExpandedWidth={sidebarDefaultExpandedWidth}');
  });
});
