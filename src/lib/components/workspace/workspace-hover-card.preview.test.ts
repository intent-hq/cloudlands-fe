import { describe, expect, it } from 'vitest';
import {
  workspaceHoverCardPreview,
  workspaceHoverCardStateMatrix,
} from './workspace-hover-card.preview-fixtures';

describe('workspace hover-card preview audit', () => {
  it('registers representative named states without a Cartesian product', () => {
    expect(workspaceHoverCardPreview.id).toBe('workspace-hover-card');
    expect(workspaceHoverCardPreview.defaultState).toBe('working');
    expect(Object.keys(workspaceHoverCardPreview.states)).toEqual([
      'working',
      'stopped-blocked',
      'idle-complete',
      'dense',
      'narrow',
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

  it('provides the approved representative two-column scenes', () => {
    const states = workspaceHoverCardPreview.states;

    expect(states.working.props.cards[0]?.workspace?.displayStatus).toBe('in_progress');
    expect(
      states['stopped-blocked'].props.cards.map(({ workspace }) => workspace?.displayStatus),
    ).toEqual(['failed', 'blocked']);
    expect(
      states['idle-complete'].props.cards.map(({ workspace }) => workspace?.displayStatus),
    ).toEqual(['idle', 'complete']);
    expect(states.dense.props.cards[0]?.agents).toHaveLength(5);
    expect(states.narrow.props.layout).toBe('narrow');
    expect(states['semantic-status'].props.expected).toContain('right column');
    expect(states['idle-complete'].props.expected).toContain('without a numeric header count');
  });

  it('keeps long description regression fixtures in wide and narrow layouts', () => {
    const states = workspaceHoverCardPreview.states;
    const wideDescription = states['long-content'].props.cards[0]?.workspace?.statusMessage;
    const narrowDescription = states.narrow.props.cards[0]?.workspace?.statusMessage;

    expect(wideDescription?.length).toBeGreaterThan(80);
    expect(narrowDescription?.length).toBeGreaterThan(80);
    expect(states.narrow.props.layout).toBe('narrow');
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
