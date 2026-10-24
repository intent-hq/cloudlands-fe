import { describe, expect, it } from 'vitest';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { getHomeTriageGroup, matchesHomeFilter, needsAttention } from './home-model';

// Failure cases: blocked/failed missing from needs-you; unread mistaken for action;
// running overriding a blocker; completed work masking a review request; prose
// inventing an error; stale unread filters breaking; archived/deleted leaking in.
const workspace = (overrides: Partial<Workspace> = {}) =>
  ({ status: WorkspaceStatusEnum.Active, ...overrides }) as Workspace;

describe('Home triage grouping', () => {
  it.each([
    ['failed', 'blocked'],
    ['blocked', 'blocked'],
    ['needs_attention', 'needs-you'],
    ['pr_ready', 'needs-you'],
    ['in_progress', 'running'],
    ['complete', 'done'],
    ['pr_merged', 'done'],
    ['not_started', 'idle'],
    ['idle', 'idle'],
    ['pr_open', 'idle'],
    ['pr_queued', 'waiting'],
  ] as const)('groups structured %s as %s', (displayStatus, group) => {
    expect(getHomeTriageGroup(workspace({ displayStatus }))).toBe(group);
  });

  it('includes blockers in Needs you while preserving their blocked status', () => {
    const blocked = workspace({
      displayStatus: 'blocked',
      activity: 'agent_running',
      attention: 'review_required',
    });
    expect(getHomeTriageGroup(blocked)).toBe('blocked');
    expect(needsAttention(blocked)).toBe(true);
    expect(matchesHomeFilter(blocked, 'attention')).toBe(true);
    expect(matchesHomeFilter(blocked, 'running')).toBe(false);
    expect(matchesHomeFilter(blocked, 'blocked')).toBe(true);
  });

  it('prioritizes explicit review requests over running and completion', () => {
    expect(
      getHomeTriageGroup(workspace({ displayStatus: 'complete', attention: 'review_required' })),
    ).toBe('needs-you');
    expect(
      getHomeTriageGroup(workspace({ activity: 'agent_running', attention: 'review_required' })),
    ).toBe('needs-you');
    expect(
      getHomeTriageGroup(workspace({ displayStatus: 'complete', activity: 'agent_running' })),
    ).toBe('running');
  });

  it('does not invent actions or failures from unread, waiting, or prose', () => {
    const idle = workspace({
      attention: 'unread',
      waiting: true,
      statusMessage: 'Blocked and failed: old log excerpt',
    });
    expect(getHomeTriageGroup(idle)).toBe('waiting');
    expect(needsAttention(idle)).toBe(false);
    expect(matchesHomeFilter(idle, 'unread')).toBe(true);
    expect(matchesHomeFilter(idle, 'blocked')).toBe(false);
    expect(getHomeTriageGroup(workspace())).toBe('idle');
  });

  it('puts command scripts in Running without outranking Needs you', () => {
    const scripts = workspace({ displayStatus: 'idle', scriptsRunning: true });
    expect(getHomeTriageGroup(scripts)).toBe('running');
    expect(matchesHomeFilter(scripts, 'running')).toBe(true);
    expect(matchesHomeFilter(scripts, 'waiting')).toBe(false);
    expect(getHomeTriageGroup(workspace({ displayStatus: 'complete', scriptsRunning: true }))).toBe(
      'running',
    );
    expect(
      getHomeTriageGroup(workspace({ displayStatus: 'needs_attention', scriptsRunning: true })),
    ).toBe('needs-you');
    expect(getHomeTriageGroup(workspace({ displayStatus: 'blocked', scriptsRunning: true }))).toBe(
      'blocked',
    );
    // Older daemons omit the flag; false and absent both read as not running.
    expect(getHomeTriageGroup(workspace({ scriptsRunning: false }))).toBe('idle');
  });

  it('groups waiting workspaces below Running and above Done & idle', () => {
    for (const displayStatus of [
      'idle',
      'not_started',
      'complete',
      'pr_merged',
      'pr_open',
    ] as const) {
      const waiting = workspace({ displayStatus, waiting: true });
      expect(getHomeTriageGroup(waiting)).toBe('waiting');
      expect(matchesHomeFilter(waiting, 'waiting')).toBe(true);
    }
    expect(matchesHomeFilter(workspace({ displayStatus: 'pr_queued' }), 'waiting')).toBe(true);
    expect(getHomeTriageGroup(workspace({ waiting: true, activity: 'agent_running' }))).toBe(
      'running',
    );
    expect(getHomeTriageGroup(workspace({ waiting: true, scriptsRunning: true }))).toBe('running');
    expect(getHomeTriageGroup(workspace({ displayStatus: 'pr_ready', waiting: true }))).toBe(
      'needs-you',
    );
    expect(getHomeTriageGroup(workspace({ waiting: true, attention: 'review_required' }))).toBe(
      'needs-you',
    );
    expect(getHomeTriageGroup(workspace({ displayStatus: 'failed', waiting: true }))).toBe(
      'blocked',
    );
    expect(matchesHomeFilter(workspace({ waiting: false }), 'waiting')).toBe(false);
    expect(
      matchesHomeFilter(
        workspace({ status: WorkspaceStatusEnum.Archived, waiting: true }),
        'waiting',
      ),
    ).toBe(false);
  });

  it('retains lifecycle exclusions and archived-only filtering', () => {
    const archived = workspace({ status: WorkspaceStatusEnum.Archived, displayStatus: 'blocked' });
    expect(matchesHomeFilter(archived, 'blocked')).toBe(false);
    expect(matchesHomeFilter(archived, 'archived')).toBe(true);
    expect(matchesHomeFilter(workspace({ status: WorkspaceStatusEnum.Deleted }), 'all')).toBe(
      false,
    );
    expect(matchesHomeFilter(workspace({ pendingDeleteAt: '2026-09-29T00:00:00Z' }), 'all')).toBe(
      false,
    );
    expect(matchesHomeFilter(workspace(), 'archived')).toBe(false);
  });
});
