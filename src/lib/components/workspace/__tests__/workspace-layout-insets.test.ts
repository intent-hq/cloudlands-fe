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
    expect(rightBranch).toContain("'pl-2 sm:pl-3'");
    expect(leftBranch).toContain('main-content-area flex h-full min-w-0 z-10');
    expect(leftBranch).not.toContain('pl-2 sm:pl-3');
  });

  it('lets a panel-free workspace column own the full sidebar width', () => {
    expect(workspaceSurface).toContain('const delayCompactFill =');
    expect(workspaceSurface).toContain('let previousColumnPanelCount: number | null = null');
    expect(workspaceSurface).toContain('{sidebarFillsAvailableWidth}');
    expect(workspaceSurface).toContain('{onSidebarWidthChange}');
    expect(workspaceSurface).toContain('disableSidebarWidthTransition={columnMode}');
    expect(workspaceLayout).toContain('doSkipResize={sidebarFillsAvailableWidth}');
    expect(workspaceLayout).toContain('disableWidthTransition={disableSidebarWidthTransition}');
    expect(workspaceLayout).toContain('preserveFixedWidthAfterFill={columnMode}');
    expect(workspaceLayout).toContain('notifyAutomaticWidthChanges={!columnMode}');
    expect(workspaceLayout).toContain('clampStoredWidth={columnMode}');
    expect(workspaceLayout).toContain('onWidthChange={onSidebarWidthChange}');
  });
});
