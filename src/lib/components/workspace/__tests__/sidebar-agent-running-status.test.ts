import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('sidebar overview status summary', () => {
  it('sorts the Agents card by last message and marks each running avatar', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');
    const preview = source('../utils/sidebar-launcher-preview.ts');

    expect(sidebar).toContain('selectAgentIsRunning.select(appStore.state, agent.id)');
    expect(preview).toContain('compareAgentsByLastMessage(a.agent, b.agent)');
    expect(sidebar).not.toContain('.sort((a, b) => Number(b.isRunning) - Number(a.isRunning))');
    expect(sidebar).toContain("data-sidebar-agent-state={isRunning ? 'running' : 'idle'}");
    expect(sidebar).toContain("state={isRunning ? 'running' : 'idle'}");
  });

  it('omits the running-agent summary from the overview', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');

    expect(sidebar).not.toContain('data-sidebar-agents-summary');
    expect(sidebar).not.toContain('launcherRunningCount');
    expect(sidebar).not.toContain('runningLauncherAgents.slice(0, 4)');
    expect(sidebar).not.toContain('data-sidebar-running-agent');
    expect(sidebar).not.toContain('data-sidebar-agents-overflow');
  });

  it('omits Activity Log and Local Changes from the sidebar overview', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');

    expect(sidebar).not.toContain('ActivityLogPreview');
    expect(sidebar).toContain('SidebarChangesPanel');
    expect(sidebar).toContain('data-sidebar-changes-panel');
    expect(sidebar).not.toContain('data-sidebar-local-changes-summary');
    expect(sidebar).not.toContain('data-sidebar-change=');
  });
});
