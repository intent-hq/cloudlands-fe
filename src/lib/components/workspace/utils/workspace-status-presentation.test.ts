import { describe, expect, it } from 'vitest';
import { WORKSPACE_DISPLAY_STATUS_VALUES } from '$shared/types';
import {
  getWorkspaceStatusPresentation,
  resolveWorkspaceStatusState,
  type WorkspaceStatusPresentationState,
} from './workspace-status-presentation';

const expected: Array<[WorkspaceStatusPresentationState, string, string, string]> = [
  ['failed', 'triangle-exclamation', 'text-destructive', 'Failed'],
  ['blocked', 'xmark', 'text-destructive', 'Blocked'],
  ['needs_attention', 'circle-exclamation', 'text-warning', 'Needs attention'],
  ['in_progress', 'circle', 'text-success', 'In progress'],
  ['waiting', 'clock', 'text-muted-foreground', 'Waiting'],
  ['unread', 'envelope', 'text-info', 'UNREAD'],
  ['not_started', 'play', 'text-muted-foreground', 'Not started'],
  ['idle', 'pause', 'text-muted-foreground', 'Idle'],
  ['complete', 'circle-check', 'text-success', 'Complete'],
  ['pr_ready', 'code-pull-request', 'text-success', 'PR Mergeable'],
  ['pr_open', 'code-pull-request', 'text-info', 'PR open'],
  ['pr_merged', 'code-merge', 'text-success', 'PR merged'],
];

describe('workspace status presentation', () => {
  it('maps every wire status and overlay to one shape, semantic color, and localized text', () => {
    expect(new Set(expected.map(([state]) => state))).toEqual(
      new Set([...WORKSPACE_DISPLAY_STATUS_VALUES, 'waiting', 'unread']),
    );
    expect(
      expected.map(([state]) => {
        const result = getWorkspaceStatusPresentation(state);
        return [result.state, result.icon.iconName, result.className, result.label];
      }),
    ).toEqual(expected);
    for (const [state] of expected) {
      const result = getWorkspaceStatusPresentation(state);
      expect(result.tooltip).toBe(result.label);
      expect(result.accessibleName).toBe(result.label);
    }
  });

  it.each(['failed', 'blocked', 'needs_attention', 'in_progress'] as const)(
    'keeps high-priority %s above waiting and unread overlays',
    (displayStatus) => {
      expect(
        resolveWorkspaceStatusState({
          displayStatus,
          activity: 'agent_running',
          attention: 'unread',
          waiting: true,
        }),
      ).toBe(displayStatus);
    },
  );

  it.each(['not_started', 'idle', 'complete', 'pr_ready', 'pr_open', 'pr_merged'] as const)(
    'uses unread before waiting over lower-priority %s',
    (displayStatus) => {
      expect(
        resolveWorkspaceStatusState({ displayStatus, attention: 'unread', waiting: true }),
      ).toBe('unread');
      expect(resolveWorkspaceStatusState({ displayStatus, attention: 'none', waiting: true })).toBe(
        'waiting',
      );
    },
  );

  it('does not infer durable state from activity or review attention', () => {
    expect(
      resolveWorkspaceStatusState({
        displayStatus: 'idle',
        activity: 'agent_running',
        attention: 'review_required',
      }),
    ).toBe('idle');
  });

  it('uses the documented not-started fallback for absent and unknown values', () => {
    expect(resolveWorkspaceStatusState({})).toBe('not_started');
    expect(resolveWorkspaceStatusState({ displayStatus: 'future_status' as never })).toBe(
      'not_started',
    );
    expect(getWorkspaceStatusPresentation('future_status')).toMatchObject({
      state: 'not_started',
      accessibleName: 'Not started',
    });
  });
});
