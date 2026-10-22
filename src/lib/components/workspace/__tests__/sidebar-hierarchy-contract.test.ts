// @verify-changed-triggers: ../MultiSelectTabbedSidebar.svelte, ../multi-select-sidebar-tabs.ts,
//   ../WorkspaceAgentsList.svelte,
//   ../WorkspaceSidebarHeader.svelte, ../TaskStatusProgress.svelte, //   ../sidebar/WorkspaceProgressCard.svelte, ../sidebar/FlameGraph.svelte,
//   ../sidebar/ContextPanel.svelte, ../sidebar/NotesPanel.svelte, ../sidebar/SidebarChangesPanel.svelte,
//   ../../layout/sidebar-nav/SidebarNav.svelte,
//   ../../layout/WindowTitleBar.svelte, ../../../../routes/(app)/+layout.svelte

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('workspace sidebar hierarchy presentation contract', () => {
  it('moves compact semantic global navigation beside the title-bar workspace tabs', () => {
    const navigation = source('../../layout/sidebar-nav/SidebarNav.svelte');
    const titleBar = source('../../layout/WindowTitleBar.svelte');
    const appLayout = source('../../../../routes/(app)/+layout.svelte');

    expect(navigation).toContain('data-top-navigation');
    expect(navigation).toContain('size="icon"');
    expect(navigation).not.toContain('SidebarNavHoverCard');
    expect(titleBar).toContain('<SidebarNav />');
    expect(titleBar.indexOf('<SidebarNav />')).toBeLessThan(titleBar.indexOf('<WorkspaceTabStrip'));
    expect(titleBar).not.toContain('ChiefTrigger');
    expect(titleBar).toContain('titlebar-left-drag-surface');
    expect(titleBar).toContain('data-titlebar-left-drag-handle');
    expect(titleBar).toContain('<WorkspaceTabStrip');
    expect(titleBar).toContain('activeWorkspaceId={routedWorkspaceId}');
    expect(titleBar).toContain('data-titlebar-settings');
    expect(appLayout).not.toContain('<SidebarNav />');
  });

  it('orders the live identity, progress, then current status', () => {
    const progress = source('../sidebar/WorkspaceProgressCard.svelte');
    const section = progress.match(/<div\b[^>]*\bdata-workspace-title-section\s*>/);
    expect(section).not.toBeNull();
    const fullMode = progress.slice(section!.index);
    const title = fullMode.indexOf('<!-- Workspace Header -->');
    const status = fullMode.indexOf('<!-- Status follows identity and progress');
    const metadata = fullMode.indexOf('<!-- repository and branch metadata -->');
    const progressSection = fullMode.indexOf('data-workspace-task-progress');

    expect(title).toBeGreaterThanOrEqual(0);
    expect(title).toBeLessThan(metadata);
    expect(metadata).toBeLessThan(progressSection);
    expect(progressSection).toBeLessThan(status);
    expect(section![0]).toMatch(/class="flex w-full flex-col"\s+data-workspace-title-section/);
    expect(fullMode).toContain('type-caption flex h-5 w-full min-w-0 items-center gap-2.5');
    expect(fullMode).toContain('class="flex w-full flex-col pb-1"');
    expect(fullMode).toContain('flex w-full flex-col gap-3.5 pb-2 text-left');
    expect(fullMode).not.toContain('pb-1 pl-1');
    expect(fullMode).not.toContain('pb-2 pl-1 text-left');
    expect(fullMode).not.toContain('px-0.5 py-1');
    expect(fullMode).toContain('{$workspace.branch}');
    expect(fullMode).toContain('presentation="repository"');
    expect(fullMode).toContain('repositoryOpen={repoTooltipOpen}');
    expect(fullMode).not.toContain('data-sidebar-branch-icon');
    expect(fullMode).not.toContain('<CheckoutModePill workspace={$workspace} />');
    expect(fullMode).not.toContain('data-workspace-title-section class="bg-');
  });

  it('renders one task progress bar with status details in its hover surface', () => {
    const progress = source('../sidebar/FlameGraph.svelte');
    const sharedProgress = source('../TaskStatusProgress.svelte');

    expect(progress).toContain('<TaskStatusProgress');
    expect(sharedProgress).toContain('role="progressbar"');
    expect(sharedProgress).toContain('style:flex-grow={segment.count}');
    expect(sharedProgress).toContain('TASK_PROGRESS_SEGMENT_CLASSES[');
    expect(sharedProgress).toContain('segment.visualState');
    expect(progress).toContain('content={taskListTooltip}');
    expect(progress).toContain('bg-secondary!');
    expect(progress).toContain('overflow-x-hidden overflow-y-auto px-2 py-1');
    expect(progress).not.toMatch(/\bp[tb]-\d/);
    expect(progress).toContain('onclick={() => specNoteId && onTaskClick?.(specNoteId)}');
    expect(progress).toContain('onclick={() => onTaskClick?.(task.note.id as string)}');
    expect(progress).toContain('TASK_STATUS_INDICATOR_CLASSES[status]');
    expect(progress).toContain('shrink-0 font-normal! text-subtle');
    expect(progress).not.toContain('hover:bg-accent/50');
    expect(progress).not.toContain('<table');
    expect(progress).not.toContain('faFileAlt');
    expect(progress).not.toContain('>Progress<');
  });

  it('uses the same three scan levels in the scoped workspace header', () => {
    const header = source('../WorkspaceSidebarHeader.svelte');

    expect(header).toContain('type-title');
    expect(header).toContain('<!-- status message -->');
    expect(header).toContain('<!-- repository and branch metadata -->');
    expect(header).toContain('type-caption flex h-5 w-full min-w-0 items-center');
  });
});
