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

  it('shows deduplicated local changes only when present and opens the changes panel', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');

    expect(sidebar).toContain('selectStagedWorkingChanges(workspaceIdStore)');
    expect(sidebar).toContain('selectUnstagedWorkingChanges(workspaceIdStore)');
    expect(sidebar).not.toContain('storeHasCorrectWorkspace');
    expect(sidebar).toContain('const localChangesCount = $derived(');
    expect(sidebar).toContain('.map((change) => change.relativePath || change.file)');
    expect(sidebar).toContain('{#if localChangesCount > 0}');
    expect(sidebar).toContain('data-sidebar-local-changes-summary');
    expect(sidebar).toContain("onclick={() => handleTabClick('changes')}");
    expect(sidebar).toContain(
      "{localChangesCount} local change{localChangesCount === 1 ? '' : 's'}",
    );
    expect(sidebar).toContain("{#if tab.id === 'changes' && localChangesCount > 0}");
    expect(sidebar).toContain('data-sidebar-changes-sync');
  });
});
