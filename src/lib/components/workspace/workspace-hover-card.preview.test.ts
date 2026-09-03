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
      'attention',
      'attention-narrow',
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
      'landscape-wide',
      'landscape-light',
      'landscape-dark',
      'landscape-narrow',
      'landscape-loading',
      'landscape-question',
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
    expect(states.attention.props.cards).toHaveLength(5);
    const mixedAttention = states.attention.props.cards.find(
      ({ key }) => key === 'attention-priority',
    );
    expect(mixedAttention?.agents?.map(({ name }) => name)).toEqual(['Maya', 'Jules', 'Rowan']);
    expect(states.attention.props.cards.map(({ key }) => key)).toContain(
      'attention-four-questions',
    );
    expect(states.attention.props.cards.map(({ key }) => key)).toContain('attention-missing-body');
    const multiQuestion = states.attention.props.cards.find(
      ({ key }) => key === 'attention-four-questions',
    );
    expect(multiQuestion?.agents?.[0]?.lastAgentResponse).toBe(
      'The deployment plan is ready after these decisions, with rollout safeguards queued for the selected region and compatibility window.',
    );
    const fallback = states.attention.props.cards.find(
      ({ key }) => key === 'attention-missing-body',
    );
    expect(fallback?.agents?.[0]?.messages).toEqual([]);
    expect(fallback?.agents?.[0]?.metadata?.pendingQuestionsMessageId).toBeTruthy();
    expect(states['attention-narrow'].props.layout).toBe('narrow');
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

  it('provides explicit landscape theme, narrow, loading, and question fixtures', () => {
    const states = workspaceHoverCardPreview.states;

    expect(states['landscape-light'].props.theme).toBe('light');
    expect(states['landscape-dark'].props.theme).toBe('dark');
    expect(states['landscape-light'].props.cards.map(({ key }) => key)).toEqual([
      'surface-third-last',
      'surface-second-last',
      'surface-last',
    ]);
    expect(states['landscape-dark'].props.cards.map(({ key }) => key)).toEqual([
      'surface-third-last',
      'surface-second-last',
      'surface-last',
    ]);
    expect(states['landscape-wide'].props.layout).not.toBe('narrow');
    expect(states['landscape-narrow'].props.layout).toBe('narrow');
    expect(states['landscape-loading'].props.cards[0]?.isLoading).toBe(true);
    expect(states['landscape-question'].props.cards[0]?.agents?.[0]?.messages).toHaveLength(1);
    expect(states['landscape-question'].props.cards[0]?.agents?.[0]?.lastAgentResponse).toContain(
      'rollout safeguards',
    );
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
      'pr_queued',
      'pr_ready',
      'pr_open',
      'pr_merged',
      undefined,
      'future_status',
    ]);
  });
});
