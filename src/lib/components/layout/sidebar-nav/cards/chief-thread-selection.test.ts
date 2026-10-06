import { describe, expect, it } from 'vitest';
import type { ChiefThreadSummary } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
import { resolveChiefThreadOnExpansion } from './chief-thread-selection';

function thread(agentId: string): ChiefThreadSummary {
  return {
    agentId,
    title: agentId,
    isActive: false,
    messageCount: 1,
  };
}

describe('resolveChiefThreadOnExpansion', () => {
  it('preserves an older thread selected by an exact-message deep link', () => {
    const newest = thread('agent-newest');
    const source = thread('agent-source');

    expect(resolveChiefThreadOnExpansion([newest, source], source.agentId, newest)).toBe(source);
  });

  it('uses the current Chief thread when no requested thread exists', () => {
    const current = thread('agent-current');

    expect(resolveChiefThreadOnExpansion([current], null, current)).toBe(current);
  });
});
