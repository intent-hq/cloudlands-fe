import { describe, expect, it } from 'vitest';
import type { ChiefThreadPreview } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
import { resolveChiefThreadOnExpansion } from './chief-thread-selection';

function thread(agentId: string, updatedAt: string): ChiefThreadPreview {
  return {
    agentId,
    title: agentId,
    preview: '',
    updatedAt,
    isActive: false,
    messageCount: 1,
  };
}

describe('resolveChiefThreadOnExpansion', () => {
  it('preserves an older thread selected by an exact-message deep link', () => {
    const newest = thread('agent-newest', '2026-08-21T12:00:00.000Z');
    const source = thread('agent-source', '2026-08-20T12:00:00.000Z');

    expect(resolveChiefThreadOnExpansion([newest, source], source.agentId, newest)).toBe(source);
  });

  it('uses the current Chief thread when no requested thread exists', () => {
    const current = thread('agent-current', '2026-08-21T12:00:00.000Z');

    expect(resolveChiefThreadOnExpansion([current], null, current)).toBe(current);
  });
});
