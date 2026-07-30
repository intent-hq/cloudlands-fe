import { describe, it, expect } from 'vitest';
import { getWorkspaceGroupingStatus, isWorkspaceRunning } from './workspace-status-grouping';
import type { Workspace } from '$shared/types';
import { WorkspaceStatus, PullRequestStatus } from '$shared/types';

function makeWorkspace(
  activity?: Workspace['activity'],
  overrides?: Partial<Workspace>,
): Workspace {
  return {
    id: 'ws-1',
    title: 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    activity,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('isWorkspaceRunning', () => {
  it('returns true when activity is agent_running', () => {
    const ws = makeWorkspace('agent_running');
    expect(isWorkspaceRunning(ws, [])).toBe(true);
  });

  it('returns true when streamingAgentIds is non-empty', () => {
    const ws = makeWorkspace('idle');
    expect(isWorkspaceRunning(ws, ['agent-1'])).toBe(true);
  });

  it('returns true when both activity is agent_running and streamingAgentIds is non-empty', () => {
    const ws = makeWorkspace('agent_running');
    expect(isWorkspaceRunning(ws, ['agent-1'])).toBe(true);
  });

  it('returns false when activity is idle and streamingAgentIds is empty', () => {
    const ws = makeWorkspace('idle');
    expect(isWorkspaceRunning(ws, [])).toBe(false);
  });

  it('returns false when activity is undefined and streamingAgentIds is empty', () => {
    const ws = makeWorkspace();
    expect(isWorkspaceRunning(ws, [])).toBe(false);
  });
});

describe('getWorkspaceGroupingStatus', () => {
  describe('running workspaces (activity === agent_running OR streaming agents > 0)', () => {
    it('returns in_progress when running with base status not_started', () => {
      const ws = makeWorkspace('agent_running');
      expect(getWorkspaceGroupingStatus(ws, 'not_started', [])).toBe('in_progress');
    });

    it('returns in_progress when running with base status in_progress', () => {
      const ws = makeWorkspace('agent_running');
      expect(getWorkspaceGroupingStatus(ws, 'in_progress', [])).toBe('in_progress');
    });

    it('returns in_progress when running with base status complete', () => {
      const ws = makeWorkspace('agent_running');
      expect(getWorkspaceGroupingStatus(ws, 'complete', [])).toBe('in_progress');
    });

    it('returns in_progress when running with base status pr_open', () => {
      const ws = makeWorkspace('agent_running');
      expect(getWorkspaceGroupingStatus(ws, 'pr_open', [])).toBe('in_progress');
    });

    it('returns in_progress when running with base status pr_ready', () => {
      const ws = makeWorkspace('agent_running');
      expect(getWorkspaceGroupingStatus(ws, 'pr_ready', [])).toBe('in_progress');
    });

    it('returns in_progress when running with base status pr_merged', () => {
      const ws = makeWorkspace('agent_running');
      expect(getWorkspaceGroupingStatus(ws, 'pr_merged', [])).toBe('in_progress');
    });

    it('returns in_progress when idle activity but has streaming agents', () => {
      const ws = makeWorkspace('idle');
      expect(getWorkspaceGroupingStatus(ws, 'pr_merged', ['agent-1'])).toBe('in_progress');
    });
  });

  describe('not-running workspaces (activity === idle AND no streaming agents)', () => {
    it('returns complete when idle with base status complete', () => {
      const ws = makeWorkspace('idle');
      expect(getWorkspaceGroupingStatus(ws, 'complete', [])).toBe('complete');
    });

    it('returns idle when idle with base status in_progress', () => {
      const ws = makeWorkspace('idle');
      expect(getWorkspaceGroupingStatus(ws, 'in_progress', [])).toBe('idle');
    });

    it('returns idle when idle with base status not_started', () => {
      const ws = makeWorkspace('idle');
      expect(getWorkspaceGroupingStatus(ws, 'not_started', [])).toBe('idle');
    });

    it('returns pr_open when idle with base status pr_open', () => {
      const ws = makeWorkspace('idle');
      expect(getWorkspaceGroupingStatus(ws, 'pr_open', [])).toBe('pr_open');
    });

    it('returns pr_ready when idle with base status pr_ready', () => {
      const ws = makeWorkspace('idle');
      expect(getWorkspaceGroupingStatus(ws, 'pr_ready', [])).toBe('pr_ready');
    });

    it('returns pr_merged when idle with base status pr_merged', () => {
      const ws = makeWorkspace('idle');
      expect(getWorkspaceGroupingStatus(ws, 'pr_merged', [])).toBe('pr_merged');
    });

    it('returns idle when activity is undefined with base status in_progress', () => {
      const ws = makeWorkspace();
      expect(getWorkspaceGroupingStatus(ws, 'in_progress', [])).toBe('idle');
    });
  });

  describe('open/draft PR wire fields prevent the idle demotion', () => {
    it('returns pr_open when idle + not_started with prStatus Open', () => {
      const ws = makeWorkspace('idle', { prStatus: PullRequestStatus.Open });
      expect(getWorkspaceGroupingStatus(ws, 'not_started', [])).toBe('pr_open');
    });

    it('returns pr_open when idle + in_progress with prStatus Draft', () => {
      const ws = makeWorkspace('idle', { prStatus: PullRequestStatus.Draft });
      expect(getWorkspaceGroupingStatus(ws, 'in_progress', [])).toBe('pr_open');
    });

    it('returns pr_open when idle + not_started with an open activePullRequest', () => {
      const ws = makeWorkspace('idle', {
        activePullRequest: {
          id: 'pr-1',
          number: 1,
          url: 'https://github.com/o/r/pull/1',
          title: 'PR',
          status: PullRequestStatus.Open,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });
      expect(getWorkspaceGroupingStatus(ws, 'not_started', [])).toBe('pr_open');
    });

    it('returns idle when the only PR is merged (merged never resurrects a PR group)', () => {
      const ws = makeWorkspace('idle', { prStatus: PullRequestStatus.Merged });
      expect(getWorkspaceGroupingStatus(ws, 'not_started', [])).toBe('idle');
    });

    it('returns idle when the only PR is closed', () => {
      const ws = makeWorkspace('idle', { prStatus: PullRequestStatus.Closed });
      expect(getWorkspaceGroupingStatus(ws, 'in_progress', [])).toBe('idle');
    });

    it('returns in_progress when running even with an open PR', () => {
      const ws = makeWorkspace('agent_running', { prStatus: PullRequestStatus.Open });
      expect(getWorkspaceGroupingStatus(ws, 'not_started', [])).toBe('in_progress');
    });
  });
});
