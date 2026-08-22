import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appLayout = readFileSync(resolve(process.cwd(), 'src/routes/(app)/+layout.svelte'), 'utf8');

describe('workspace frame outer inset', () => {
  it('keeps the bottom inset on the non-shrinking shell boundary', () => {
    expect(appLayout).toContain('workspace-frame-row flex flex-1 min-h-0 bg-transparent pb-2 pl-2');
    expect(appLayout).toContain(
      'workspace-frame relative mr-2 flex min-h-0 min-w-0 flex-1 bg-transparent',
    );
    expect(appLayout).not.toContain('workspace-frame relative mr-2 mb-2');
  });

  it('keeps the single-workspace surface rounded while columns remain transparent', () => {
    expect(appLayout).toContain("showWorkspaceColumns\n              ? ''");
    expect(appLayout).toContain(": 'rounded-xl bg-sidebar border border-border shadow-sm'");
  });

  it('keeps the workspace frame from becoming an outer vertical scroll owner', () => {
    expect(appLayout).toContain('class="flex-1 min-h-0 overflow-hidden"');
    expect(appLayout).not.toContain('class:overflow-auto={!showWorkspaceColumns}');
  });

  it('uses titlebar geometry and semantic overlap state without changing frame dimensions', () => {
    expect(appLayout).toContain('class="workspace-sidebar-frame relative z-40');
    expect(appLayout).toContain(
      'class:workspace-columns-overlap={showWorkspaceColumns && workspaceColumnsOverlap}',
    );
    expect(appLayout).toContain('onHorizontalOverlapChange={(overlap)');
    expect(appLayout).toContain('style:padding-top={showWorkspaceColumns');
    const appLayoutCss = readFileSync(
      resolve(process.cwd(), 'src/routes/(app)/app-layout.css'),
      'utf8',
    );
    expect(appLayoutCss).toContain('box-shadow: var(--elevation-raised)');
    expect(appLayoutCss).toContain('transition: opacity var(--motion-fast) ease');
  });
});
