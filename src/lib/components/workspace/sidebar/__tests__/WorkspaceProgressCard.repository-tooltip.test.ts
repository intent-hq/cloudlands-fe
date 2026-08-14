import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'src/lib/components/workspace/sidebar/WorkspaceProgressCard.svelte',
  'utf8',
);

describe('WorkspaceProgressCard repository tooltip', () => {
  it('uses compact, borderless repository and branch hover surfaces', () => {
    expect(source).toContain('data-sidebar-repository-hover-card');
    expect(source).toContain('bind:open={repoTooltipOpen}');
    expect(source).toContain('onclick={copyRepoPath}');
    expect(source).toContain('onclick={copyBranchName}');
    expect(source.match(/\n\s+disableCloseOnTriggerClick\n/g)).toHaveLength(2);
    expect(source.match(/contentClass="border-0!"/g)).toHaveLength(2);
    expect(source.match(/contentContainerClass="p-0! space-y-0!"/g)).toHaveLength(2);
    expect(source.match(/showArrow=\{false\}/g)).toHaveLength(2);
    expect(source.match(/w-56 p-2\.5/g)).toHaveLength(2);
    expect(source).not.toContain('Click to copy repository path');
    expect(source).not.toContain('Click to copy branch name');
    expect(source).toContain('presentation="repository"');
    expect(source).toContain('repositoryOpen={repoTooltipOpen}');
    expect(source).not.toContain('data-sidebar-branch-icon');
    expect(source).not.toContain("$workspace.skipWorktree ? 'Direct checkout' : 'Worktree'");
  });

  it('renders the hover-card path as a link-styled copy button', () => {
    expect(source).toContain('data-sidebar-repository-path-copy');
    expect(source).toContain('{#if workspacePath}');
    expect(source.match(/onclick=\{copyRepoPath\}/g)).toHaveLength(2);
    const pathButton = source.match(
      /<Button[^>]*data-sidebar-repository-path-copy[\s\S]*?<\/Button>/,
    );
    expect(pathButton).not.toBeNull();
    expect(pathButton?.[0]).toContain('variant="plain"');
    expect(pathButton?.[0]).toContain('underline decoration-dotted underline-offset-2');
    expect(pathButton?.[0]).toContain('truncate');
    expect(pathButton?.[0]).toContain('title={workspacePath}');
    expect(pathButton?.[0]).toContain('aria-label={m.workspace_progressCard_copyPath_ariaLabel()}');
  });
});
