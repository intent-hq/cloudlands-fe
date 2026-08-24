import { describe, expect, it } from 'vitest';
import {
  workspaceHoverCardPreview,
  workspaceHoverCardStateMatrix,
} from './workspace-hover-card.preview-fixtures';

describe('workspace hover-card preview audit', () => {
  it('registers representative named states without a Cartesian product', () => {
    expect(workspaceHoverCardPreview.id).toBe('workspace-hover-card');
    expect(workspaceHoverCardPreview.defaultState).toBe('semantic-status');
    expect(Object.keys(workspaceHoverCardPreview.states)).toEqual([
      'readiness',
      'identity-lifecycle',
      'semantic-status',
      'overlays',
      'messages',
      'tasks',
      'agents',
      'pull-requests',
      'changes-recency',
      'media',
      'long-content',
      'placement',
    ]);
  });

  it('has an explicit expected result, coverage route, and conflict rule for every family', () => {
    expect(workspaceHoverCardStateMatrix.map(({ family }) => family)).toEqual([
      'Input',
      'Identity',
      'Lifecycle',
      'Semantic status',
      'Overlays',
      'Status message',
      'Tasks',
      'Agents',
      'Pull requests',
      'Changes',
      'Recency',
      'Media',
      'Layout',
      'Integration',
    ]);
    for (const entry of workspaceHoverCardStateMatrix) {
      expect(entry.states).not.toBe('');
      expect(entry.expected).not.toBe('');
      expect(entry.coverage).not.toBe('');
      expect(entry.conflicts).not.toBe('');
    }
  });

  it('keeps all hover-card scenes local and disables production data loading', () => {
    for (const state of Object.values(workspaceHoverCardPreview.states)) {
      expect(state.setup).toEqual(expect.any(Function));
      expect(state.props.cards.length).toBeGreaterThan(0);
      for (const card of state.props.cards) {
        expect(card.key).toMatch(/^[a-z0-9-]+$/);
        expect(card.workspace?.id ?? null).not.toBe('');
      }
    }
  });

  it('covers every canonical status and status fallback input', () => {
    const cards = workspaceHoverCardPreview.states['semantic-status'].props.cards;
    expect(cards.map(({ workspace }) => workspace?.displayStatus)).toEqual([
      'failed',
      'blocked',
      'needs_attention',
      'in_progress',
      'not_started',
      'idle',
      'complete',
      'pr_ready',
      'pr_open',
      'pr_merged',
      undefined,
      'future_status',
    ]);
  });
});
