import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const panelSource = readFileSync(
  resolve(process.cwd(), 'src/lib/components/layout/sidebar-nav/SidebarPanel.svelte'),
  'utf8',
);
const chiefSource = readFileSync(
  resolve(process.cwd(), 'src/lib/components/layout/sidebar-nav/cards/ChiefCard.svelte'),
  'utf8',
);

describe('All Workspaces panel presentation', () => {
  it('keeps Spaces and Chief mounted without root-route special casing', () => {
    expect(panelSource).not.toContain("page.url.pathname === '/'");
    expect(panelSource).toContain('data-combined-panel-spaces');
    expect(panelSource).toContain('style:height={$isChiefCollapsed$');
    expect(panelSource).toContain('height var(--motion-slow) var(--ease-emphasized-out)');
    expect(panelSource.match(/<ChiefCard\s+expanded=\{true\}/g)).toHaveLength(1);
    expect(panelSource).not.toMatch(
      /function handleExpandHome\(\) \{\s*appStore\.dispatch\(closePanel\(\)\)/,
    );
  });

  it('offers a create-space action while the Spaces section is visible', () => {
    expect(panelSource).toContain('data-spaces-create');
    expect(panelSource).toContain('navigateToNewWorkspace()');
  });

  it('omits close controls from the combined Spaces and Chief panel', () => {
    const combinedPanel = panelSource.slice(
      panelSource.indexOf('{#if isCombinedWorkspace}'),
      panelSource.indexOf('{:else}\n        <!-- Header -->'),
    );

    expect(combinedPanel).not.toContain('closePanel()');
    expect(chiefSource).not.toContain('closePanel');
    expect(chiefSource).not.toContain('faXmark');
  });
});
