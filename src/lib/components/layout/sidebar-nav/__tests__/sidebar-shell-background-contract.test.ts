import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('sidebar shell background ownership', () => {
  it('keeps the canonical shell transparent in both themes', () => {
    const panel = source('src/lib/components/layout/sidebar-nav/SidebarPanel.svelte');

    expect(panel).toContain('sidebar-panel h-full flex flex-col relative text-sidebar-foreground');
    expect(panel).not.toMatch(/sidebar-panel[^"\n]*(?:bg-sidebar|background)/);
    expect(panel).toMatch(/class="shrink-0 h-full overflow-hidden"\s+data-sidebar-panel/);
    expect(panel).not.toMatch(/data-sidebar-panel[^>]+(?:bg-sidebar|background)/s);
  });

  it('preserves contained surfaces and the approved dark neutral tokens', () => {
    const allWorkspaces = source(
      'src/lib/components/layout/sidebar-nav/cards/AllWorkspacesCard.svelte',
    );
    const workspaceCard = source('src/lib/components/workspace/WorkspaceCard.svelte');
    const tokens = source('src/lib/styles/tokens.css');

    expect(allWorkspaces).toContain('border-t border-border');
    expect(allWorkspaces).toContain('border border-border bg-background/30');
    expect(workspaceCard).toContain('hover:bg-background/40');
    expect(workspaceCard).toContain("selected && 'bg-primary/5 ring-1 ring-primary/30'");
    expect(allWorkspaces).toContain('overflow-y-auto flex-1 min-h-0 pt-1 pb-2');
    expect(tokens).toContain('--theme-dark-background: 0 0% 10.1960784314%;');
    expect(tokens).toContain('--theme-dark-sidebar: 0 0% 14.9019607843%;');
  });
});
