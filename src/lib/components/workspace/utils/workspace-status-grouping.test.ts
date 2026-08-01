import { describe, it, expect } from 'vitest';
import { getWorkspaceGroupingStatus, isWorkspaceRunning } from './workspace-status-grouping';
import type { Workspace } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

function makeWorkspace(
  activity?: Workspace['activity'],
  displayStatus?: Workspace['displayStatus'],
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
    displayStatus,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
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

  describe('BE-sent displayStatus is consumed verbatim (intentd#793 — daemon owns the idle split)', () => {
    it('returns idle when the BE says idle', () => {
      const ws = makeWorkspace('idle', 'idle');
      expect(getWorkspaceGroupingStatus(ws, 'idle', [])).toBe('idle');
    });

    it('returns in_progress when the BE says in_progress, even with no local agent rows', () => {
      const ws = makeWorkspace('idle', 'in_progress');
      expect(getWorkspaceGroupingStatus(ws, 'in_progress', [])).toBe('in_progress');
    });

    it('returns not_started verbatim when the BE sends it', () => {
      const ws = makeWorkspace('idle', 'not_started');
      expect(getWorkspaceGroupingStatus(ws, 'not_started', [])).toBe('not_started');
    });

    it('a running workspace still overrides a BE-sent idle to in_progress', () => {
      const ws = makeWorkspace('agent_running', 'idle');
      expect(getWorkspaceGroupingStatus(ws, 'idle', [])).toBe('in_progress');
    });

    it('streaming agents still override a BE-sent idle to in_progress', () => {
      const ws = makeWorkspace('idle', 'idle');
      expect(getWorkspaceGroupingStatus(ws, 'idle', ['agent-1'])).toBe('in_progress');
    });
  });

  describe('not-running workspaces without a BE displayStatus (local-derivation fallback)', () => {
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
});
