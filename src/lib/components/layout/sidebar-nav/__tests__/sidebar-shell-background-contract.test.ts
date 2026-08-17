import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('sidebar shell background ownership', () => {
  it('keeps the canonical shell filled only outside dark mode', () => {
    const panel = source('src/lib/components/layout/sidebar-nav/SidebarPanel.svelte');

    expect(panel).toContain(
      'sidebar-panel h-full flex flex-col relative bg-sidebar text-sidebar-foreground dark:bg-transparent',
    );
    expect(panel).toMatch(/class="shrink-0 h-full overflow-hidden"\s+data-sidebar-panel/);
    expect(panel).not.toMatch(/data-sidebar-panel[^>]+(?:bg-sidebar|background)/s);
  });

  it('preserves contained surfaces and canonical dark token lightness', () => {
    const allWorkspaces = source(
      'src/lib/components/layout/sidebar-nav/cards/AllWorkspacesCard.svelte',
    );
    const workspaceCard = source('src/lib/components/workspace/WorkspaceCard.svelte');
    const tokens = source('src/lib/styles/tokens.css');

    expect(allWorkspaces).toContain('border-t border-border');
    expect(allWorkspaces).toContain('border border-border bg-background/30');
    expect(workspaceCard).toContain('hover:bg-background/40');
    expect(workspaceCard).toContain("selected && 'bg-primary/5 ring-1 ring-primary/30'");
    expect(tokens).toContain('--theme-dark-background: 154 16% 3%;');
    expect(tokens).toContain('--theme-dark-sidebar: 154 16% 5%;');
  });
});
