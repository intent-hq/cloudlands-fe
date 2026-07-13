import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('line-stat request eagerness checks', () => {
  it('AgentCard renders selector data without dispatching line-stat requests on mount', () => {
    const source = readSource('../AgentCard.svelte');

    expect(source).toContain('selectAgentLineStats(agentIdStore)');
    expect(source).not.toContain('requestAgentLineStats');
  });

  it('AgentOverviewPanel does not bulk request line stats for graph nodes', () => {
    const source = readSource('../../agent-overview/AgentOverviewPanel.svelte');

    expect(source).not.toContain('requestAgentLineStats');
    expect(source).not.toMatch(/agentNodes[\s\S]*appStore\.dispatch\(/);
  });

  it('AgentPeekCard requests only when expanded line stats are visible', () => {
    const source = readSource('../../tiptap/comments/AgentPeekCard.svelte');

    expect(source).toContain("if (displayMode === 'icon' || isCollapsed) return;");
    expect(source).toContain('appStore.dispatch(requestAgentLineStats(agentId));');
  });
});