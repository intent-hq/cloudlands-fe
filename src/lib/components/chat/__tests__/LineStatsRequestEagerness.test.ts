// @verify-changed-triggers: ../AgentCard.svelte, ../../tiptap/comments/AgentPeekCard.svelte

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

  it('AgentPeekCard requests only when expanded line stats are visible', () => {
    const source = readSource('../../tiptap/comments/AgentPeekCard.svelte');

    expect(source).toContain("if (displayMode === 'icon' || isCollapsed) return;");
    expect(source).toContain('appStore.dispatch(requestAgentLineStats(agentId));');
  });
});
