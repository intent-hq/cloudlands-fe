import { describe, expect, it } from 'vitest';
import { WORKSPACE_DISPLAY_STATUS_VALUES } from '$shared/types';
import {
  getWorkspaceStatusPresentation,
  resolveWorkspaceStatusState,
  type WorkspaceStatusPresentationState,
} from './workspace-status-presentation';

const expected: Array<
  [WorkspaceStatusPresentationState, 'dot' | 'icon', string | null, string, string]
> = [
  ['failed', 'icon', 'triangle-exclamation', 'text-foreground', 'Failed'],
  ['blocked', 'icon', 'xmark', 'text-destructive', 'Blocked'],
  ['needs_attention', 'icon', 'circle-question', 'text-warning', 'Needs attention'],
  ['in_progress', 'dot', null, 'workspace-status-color-active', 'In progress'],
  ['waiting', 'icon', 'clock', 'text-muted-foreground', 'Waiting'],
  ['unread', 'dot', null, 'workspace-status-color-unread', 'Unread'],
  ['not_started', 'dot', null, 'text-muted-foreground/35', 'Not started'],
  ['idle', 'dot', null, 'text-muted-foreground/35', 'Idle'],
  ['complete', 'icon', 'circle-check', 'text-success', 'Complete'],
  ['pr_queued', 'icon', 'hourglass-half', 'text-info', 'Queued to merge'],
  ['pr_ready', 'icon', 'code-pull-request', 'text-success', 'PR Mergeable'],
  ['pr_open', 'icon', 'code-pull-request', 'text-info', 'PR open'],
  ['pr_merged', 'icon', 'code-merge', 'text-purple-500', 'PR merged'],
];

describe('workspace status presentation', () => {
  it('maps every wire status and overlay to one shape, semantic color, and localized text', () => {
    expect(new Set(expected.map(([state]) => state))).toEqual(
      new Set([...WORKSPACE_DISPLAY_STATUS_VALUES, 'waiting', 'unread']),
    );
    expect(
      expected.map(([state]) => {
        const result = getWorkspaceStatusPresentation(state);
        return [
          result.state,
          result.visual,
          result.icon?.iconName ?? null,
          result.className,
          result.label,
        ];
      }),
    ).toEqual(expected);
    for (const [state] of expected) {
      const result = getWorkspaceStatusPresentation(state);
      expect(result.tooltip).toBe(result.label);
      expect(result.accessibleName).toBe(result.label);
      expect(result.label).not.toBe(result.label.toUpperCase());
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

  it('keeps pending user input above unread, working, and idle visuals', () => {
    expect(
      resolveWorkspaceStatusState({
        displayStatus: 'needs_attention',
        activity: 'agent_running',
        attention: 'unread',
      }),
    ).toBe('needs_attention');
    expect(getWorkspaceStatusPresentation('needs_attention')).toMatchObject({
      visual: 'icon',
      accessibleName: 'Needs attention',
    });
  });

  it.each([
    'not_started',
    'idle',
    'complete',
    'pr_queued',
    'pr_ready',
    'pr_open',
    'pr_merged',
  ] as const)('uses unread before waiting over lower-priority %s', (displayStatus) => {
    expect(resolveWorkspaceStatusState({ displayStatus, attention: 'unread', waiting: true })).toBe(
      'unread',
    );
    expect(resolveWorkspaceStatusState({ displayStatus, attention: 'none', waiting: true })).toBe(
      'waiting',
    );
  });

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
