import { describe, it, expect } from 'vitest';
import { ChangeStage, type TrackedChange, type CommitInfo } from '$features/file-tracking/types';
import type { AgentChangeGroup } from '$lib/components/file-tracking/accept-changes/types';
import {
  getBranchNameValidationError,
  constructPrUrl,
  toPRDisplayStatus,
  getGroupKey,
  getCommitsToPushCount,
  getCommitsToUndoCount,
  getLocalCommitsToUndoCount,
  getPushTooltip,
  getUndoTooltip,
  getUndoCommitTooltip,
  canAmendCommit,
  isFileActive,
  isFileSelected,
  isFileFocused,
  isAgentGroupCollapsed,
  toUIFileChange,
} from '../sidebar-changes-utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCommit(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash: 'abc123',
    message: 'test commit',
    author: 'Test',
    timestamp: Date.now(),
    files: [],
    stage: 'local' as const,
    isPushed: false,
    ...overrides,
  };
}

function makeTrackedChange(overrides: Partial<TrackedChange> = {}): TrackedChange {
  return {
    id: 'change-1',
    file: '/repo/src/foo.ts',
    relativePath: 'src/foo.ts',
    stage: ChangeStage.Unstaged,
    stats: { additions: 10, deletions: 5 },
    status: 'modified',
    attribution: { timestamp: 1000 },
    ...overrides,
  } as TrackedChange;
}

function makeGroup(overrides: Partial<AgentChangeGroup> = {}): AgentChangeGroup {
  return {
    agentId: 'agent-1',
    agentName: 'Test Agent',
    files: [],
    stats: { fileCount: 0, additions: 0, deletions: 0 },
    ...overrides,
  };
}

// ─── getBranchNameValidationError ─────────────────────────────────────────────

describe('getBranchNameValidationError', () => {
  it('returns undefined for valid branch names', () => {
    expect(getBranchNameValidationError('feature/my-branch')).toBeUndefined();
    expect(getBranchNameValidationError('main')).toBeUndefined();
    expect(getBranchNameValidationError('fix-123')).toBeUndefined();
    expect(getBranchNameValidationError('a')).toBeUndefined();
  });

  it('rejects empty string', () => {
    expect(getBranchNameValidationError('')).toBe('Branch name cannot be empty');
  });

  it('rejects whitespace-only', () => {
    expect(getBranchNameValidationError('   ')).toBe('Branch name cannot be empty');
  });

  it('rejects spaces', () => {
    expect(getBranchNameValidationError('my branch')).toBe('Branch name contains invalid characters');
  });

  it('rejects tabs', () => {
    expect(getBranchNameValidationError('feat\ttab')).toBe('Branch name contains invalid characters');
  });

  it('rejects newlines', () => {
    expect(getBranchNameValidationError('feat\nnewline')).toBe(
      'Branch name contains invalid characters',
    );
  });

  it('rejects backslash', () => {
    expect(getBranchNameValidationError('feat\\bar')).toBe('Branch name contains invalid characters');
  });

  it('rejects tilde', () => {
    expect(getBranchNameValidationError('feat~1')).toBe('Branch name contains invalid characters');
  });

  it('rejects caret', () => {
    expect(getBranchNameValidationError('feat^1')).toBe('Branch name contains invalid characters');
  });

  it('rejects colon', () => {
    expect(getBranchNameValidationError('feat:1')).toBe('Branch name contains invalid characters');
  });

  it('rejects question mark', () => {
    expect(getBranchNameValidationError('feat?')).toBe('Branch name contains invalid characters');
  });

  it('rejects asterisk', () => {
    expect(getBranchNameValidationError('feat*')).toBe('Branch name contains invalid characters');
  });

  it('rejects open bracket', () => {
    expect(getBranchNameValidationError('feat[')).toBe('Branch name contains invalid characters');
  });

  it('rejects at-brace sequence @{', () => {
    expect(getBranchNameValidationError('feat@{')).toBe('Branch name cannot contain the sequence @{');
    expect(getBranchNameValidationError('@{upstream}')).toBe('Branch name cannot contain the sequence @{');
  });

  it('rejects @ as entire branch name', () => {
    expect(getBranchNameValidationError('@')).toBe('Branch name cannot be @');
  });

  it('allows bare @ in branch names', () => {
    expect(getBranchNameValidationError('feat@bar')).toBeUndefined();
    expect(getBranchNameValidationError('user@feature')).toBeUndefined();
  });

  it('allows bare { in branch names', () => {
    expect(getBranchNameValidationError('feat{bar')).toBeUndefined();
    expect(getBranchNameValidationError('{feature}')).toBeUndefined();
  });

  it('rejects starting with dot', () => {
    expect(getBranchNameValidationError('.hidden')).toBe("Branch name cannot start with '.'");
  });

  it('rejects ending with .lock', () => {
    expect(getBranchNameValidationError('branch.lock')).toBe(
      "Branch name cannot end with '.lock'",
    );
  });

  it('rejects consecutive dots', () => {
    expect(getBranchNameValidationError('a..b')).toBe("Branch name cannot contain '..'");
  });

  it('rejects starting with slash', () => {
    expect(getBranchNameValidationError('/branch')).toBe(
      'Branch name cannot start or end with /',
    );
  });

  it('rejects ending with slash', () => {
    expect(getBranchNameValidationError('branch/')).toBe(
      'Branch name cannot start or end with /',
    );
  });

  it('rejects consecutive slashes', () => {
    expect(getBranchNameValidationError('a//b')).toBe(
      'Branch name cannot contain consecutive slashes',
    );
  });

  it('rejects starting with dash', () => {
    expect(getBranchNameValidationError('-branch')).toBe("Branch name cannot start with '-'");
  });

  it('rejects ending with a period', () => {
    expect(getBranchNameValidationError('name.')).toBe('Branch name cannot end with a period');
  });

  it('rejects component starting with dot', () => {
    expect(getBranchNameValidationError('refs/.hidden/branch')).toBe(
      "Branch name component cannot start with '.'",
    );
  });

  it('rejects component ending with .lock', () => {
    expect(getBranchNameValidationError('feature/main.lock')).toBe(
      "Branch name cannot end with '.lock'",
    );
  });

  it('rejects names longer than 250 chars', () => {
    expect(getBranchNameValidationError('a'.repeat(251))).toBe(
      'Branch name is too long (max 250 characters)',
    );
  });

  it('accepts exactly 250 chars', () => {
    expect(getBranchNameValidationError('a'.repeat(250))).toBeUndefined();
  });
});

// ─── constructPrUrl ───────────────────────────────────────────────────────────

describe('constructPrUrl', () => {
  it('constructs URL from owner and repo', () => {
    expect(constructPrUrl(42, 'octocat', 'hello-world')).toBe(
      'https://github.com/octocat/hello-world/pull/42',
    );
  });

  it('returns fallback when owner is missing', () => {
    expect(constructPrUrl(42, undefined, 'repo', 'https://fallback.com')).toBe(
      'https://fallback.com',
    );
  });

  it('returns fallback when repo is missing', () => {
    expect(constructPrUrl(42, 'owner', undefined, 'https://fallback.com')).toBe(
      'https://fallback.com',
    );
  });

  it('returns empty string when no fallback and no repo info', () => {
    expect(constructPrUrl(42, undefined, undefined)).toBe('');
  });
});

// ─── toPRDisplayStatus ────────────────────────────────────────────────────────

describe('toPRDisplayStatus', () => {
  it('maps Open to open', () => expect(toPRDisplayStatus('Open')).toBe('open'));
  it('maps Merged to merged', () => expect(toPRDisplayStatus('Merged')).toBe('merged'));
  it('maps Draft to draft', () => expect(toPRDisplayStatus('Draft')).toBe('draft'));
  it('maps Closed to closed', () => expect(toPRDisplayStatus('Closed')).toBe('closed'));
  it('maps unknown to closed', () => expect(toPRDisplayStatus('anything')).toBe('closed'));
  it('maps empty to closed', () => expect(toPRDisplayStatus('')).toBe('closed'));
});

// ─── getGroupKey ──────────────────────────────────────────────────────────────

describe('getGroupKey', () => {
  it('returns section:agentId for agent groups', () => {
    expect(getGroupKey(makeGroup({ agentId: 'agent-1' }), 'unstaged')).toBe('unstaged:agent-1');
    expect(getGroupKey(makeGroup({ agentId: 'agent-2' }), 'staged')).toBe('staged:agent-2');
  });
  it('returns section:manual for null agentId', () => {
    expect(getGroupKey(makeGroup({ agentId: null }), 'unstaged')).toBe('unstaged:manual');
  });
});

// ─── Commit counting functions ────────────────────────────────────────────────

describe('getCommitsToPushCount', () => {
  const commits = [
    makeCommit({ isPushed: false }),
    makeCommit({ isPushed: true }),
    makeCommit({ isPushed: false }),
    makeCommit({ isPushed: true }),
  ];

  it('counts unpushed from index to end', () => {
    expect(getCommitsToPushCount(commits, 0)).toBe(2);
    expect(getCommitsToPushCount(commits, 1)).toBe(1);
    expect(getCommitsToPushCount(commits, 2)).toBe(1);
    expect(getCommitsToPushCount(commits, 3)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(getCommitsToPushCount([], 0)).toBe(0);
  });
});

describe('getCommitsToUndoCount', () => {
  const commits = [
    makeCommit({ isPushed: true }),
    makeCommit({ isPushed: false }),
    makeCommit({ isPushed: true }),
  ];

  it('counts pushed from 0 to index', () => {
    expect(getCommitsToUndoCount(commits, 0)).toBe(1);
    expect(getCommitsToUndoCount(commits, 1)).toBe(1);
    expect(getCommitsToUndoCount(commits, 2)).toBe(2);
  });
});

describe('getLocalCommitsToUndoCount', () => {
  const commits = [
    makeCommit({ isPushed: false }),
    makeCommit({ isPushed: true }),
    makeCommit({ isPushed: false }),
  ];

  it('counts unpushed from 0 to index', () => {
    expect(getLocalCommitsToUndoCount(commits, 0)).toBe(1);
    expect(getLocalCommitsToUndoCount(commits, 1)).toBe(1);
    expect(getLocalCommitsToUndoCount(commits, 2)).toBe(2);
  });
});

// ─── Tooltip functions ────────────────────────────────────────────────────────

describe('getPushTooltip', () => {
  it('singular commit without PR', () => {
    const commits = [makeCommit({ isPushed: false })];
    expect(getPushTooltip(commits, 0, false, 'my-branch')).toBe(
      'Push commit to remote (origin/my-branch)',
    );
  });

  it('plural commits without PR', () => {
    const commits = [makeCommit({ isPushed: false }), makeCommit({ isPushed: false })];
    expect(getPushTooltip(commits, 0, false, 'feat')).toBe(
      'Push 2 commits to remote (origin/feat)',
    );
  });

  it('singular commit with PR', () => {
    const commits = [makeCommit({ isPushed: false })];
    expect(getPushTooltip(commits, 0, true, 'feat')).toBe('Add commit to PR (origin/feat)');
  });

  it('plural commits with PR', () => {
    const commits = [makeCommit({ isPushed: false }), makeCommit({ isPushed: false })];
    expect(getPushTooltip(commits, 0, true, undefined)).toBe('Add 2 commits to PR');
  });

  it('no branch name omits suffix', () => {
    const commits = [makeCommit({ isPushed: false })];
    expect(getPushTooltip(commits, 0, false, undefined)).toBe('Push commit to remote');
  });
});

describe('getUndoTooltip', () => {
  it('singular pushed commit', () => {
    const commits = [makeCommit({ isPushed: true })];
    expect(getUndoTooltip(commits, 0, 'main')).toBe('Undo push from remote (origin/main)');
  });

  it('plural pushed commits', () => {
    const commits = [makeCommit({ isPushed: true }), makeCommit({ isPushed: true })];
    expect(getUndoTooltip(commits, 1, 'dev')).toBe('Undo 2 commits from remote (origin/dev)');
  });

  it('no branch name', () => {
    const commits = [makeCommit({ isPushed: true })];
    expect(getUndoTooltip(commits, 0, undefined)).toBe('Undo push from remote');
  });
});

describe('getUndoCommitTooltip', () => {
  it('singular local commit', () => {
    const commits = [makeCommit({ isPushed: false })];
    expect(getUndoCommitTooltip(commits, 0)).toBe(
      'Undo commit (bring changes back to staging)',
    );
  });

  it('plural local commits', () => {
    const commits = [makeCommit({ isPushed: false }), makeCommit({ isPushed: false })];
    expect(getUndoCommitTooltip(commits, 1)).toBe(
      'Undo 2 commits (bring changes back to staging)',
    );
  });
});

// ─── canAmendCommit ───────────────────────────────────────────────────────────

describe('canAmendCommit', () => {
  it('returns true for index 0 with commits', () => {
    expect(canAmendCommit([makeCommit()], 0)).toBe(true);
  });

  it('returns false for index > 0', () => {
    expect(canAmendCommit([makeCommit(), makeCommit()], 1)).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(canAmendCommit([], 0)).toBe(false);
  });
});

// ─── isFileActive ─────────────────────────────────────────────────────────────

describe('isFileActive', () => {
  it('returns true when path and staged match', () => {
    expect(isFileActive('src/foo.ts', true, 'src/foo.ts', true)).toBe(true);
    expect(isFileActive('src/foo.ts', false, 'src/foo.ts', false)).toBe(true);
  });

  it('returns false when path matches but staged differs', () => {
    expect(isFileActive('src/foo.ts', true, 'src/foo.ts', false)).toBe(false);
  });

  it('returns false when activeFilePath is null', () => {
    expect(isFileActive('src/foo.ts', true, null, true)).toBe(false);
  });

  it('returns false when activeFilePath is undefined', () => {
    expect(isFileActive('src/foo.ts', true, undefined, true)).toBe(false);
  });

  it('returns false when activeFileStaged is null', () => {
    expect(isFileActive('src/foo.ts', true, 'src/foo.ts', null)).toBe(false);
  });

  it('returns false when activeFileStaged is undefined', () => {
    expect(isFileActive('src/foo.ts', true, 'src/foo.ts', undefined)).toBe(false);
  });

  it('returns false when paths differ', () => {
    expect(isFileActive('src/bar.ts', true, 'src/foo.ts', true)).toBe(false);
  });
});

// ─── isFileSelected ───────────────────────────────────────────────────────────

describe('isFileSelected', () => {
  it('returns true when file is in selected set (staged)', () => {
    const selected = new Set(['staged:src/foo.ts']);
    expect(isFileSelected('src/foo.ts', true, selected)).toBe(true);
  });

  it('returns true when file is in selected set (unstaged)', () => {
    const selected = new Set(['unstaged:src/foo.ts']);
    expect(isFileSelected('src/foo.ts', false, selected)).toBe(true);
  });

  it('returns false when file is not in set', () => {
    const selected = new Set(['staged:src/bar.ts']);
    expect(isFileSelected('src/foo.ts', true, selected)).toBe(false);
  });

  it('returns false when staged status differs', () => {
    const selected = new Set(['staged:src/foo.ts']);
    expect(isFileSelected('src/foo.ts', false, selected)).toBe(false);
  });

  it('returns false for empty set', () => {
    expect(isFileSelected('src/foo.ts', true, new Set())).toBe(false);
  });
});

// ─── isFileFocused ────────────────────────────────────────────────────────────

describe('isFileFocused', () => {
  it('returns true when path and staged match', () => {
    expect(isFileFocused('src/foo.ts', true, { path: 'src/foo.ts', staged: true })).toBe(true);
  });

  it('returns false when path differs', () => {
    expect(isFileFocused('src/bar.ts', true, { path: 'src/foo.ts', staged: true })).toBe(false);
  });

  it('returns false when staged differs', () => {
    expect(isFileFocused('src/foo.ts', false, { path: 'src/foo.ts', staged: true })).toBe(false);
  });

  it('returns false when focusedFile is null', () => {
    expect(isFileFocused('src/foo.ts', true, null)).toBe(false);
  });
});

// ─── isAgentGroupCollapsed ────────────────────────────────────────────────────

describe('isAgentGroupCollapsed', () => {
  it('returns true when agentId is in collapsed set', () => {
    const collapsed = new Set(['agent-1']);
    expect(isAgentGroupCollapsed('agent-1', collapsed)).toBe(true);
  });

  it('returns false when agentId is not in collapsed set', () => {
    const collapsed = new Set(['agent-2']);
    expect(isAgentGroupCollapsed('agent-1', collapsed)).toBe(false);
  });

  it('uses "manual" key for null agentId', () => {
    const collapsed = new Set(['manual']);
    expect(isAgentGroupCollapsed(null, collapsed)).toBe(true);
  });

  it('returns false for null agentId when manual not collapsed', () => {
    expect(isAgentGroupCollapsed(null, new Set())).toBe(false);
  });
});

// ─── toUIFileChange ───────────────────────────────────────────────────────────

describe('toUIFileChange', () => {
  it('converts basic tracked change', () => {
    const change = makeTrackedChange();
    const result = toUIFileChange(change, false);
    expect(result.path).toBe('src/foo.ts');
    expect(result.additions).toBe(10);
    expect(result.deletions).toBe(5);
    expect(result.staged).toBe(false);
    expect(result.status).toBe('modified');
    expect(result.attribution).toBeUndefined();
  });

  it('sets staged to true', () => {
    const result = toUIFileChange(makeTrackedChange(), true);
    expect(result.staged).toBe(true);
  });

  it('maps agent attribution', () => {
    const change = makeTrackedChange({
      attribution: {
        agent: {
          agentId: 'agent-1',
          agentName: 'My Agent',
          sessionId: 'sess-1',
          turnNumber: 3,
          timestamp: 5000,
        },
        timestamp: 5000,
      },
    });
    const result = toUIFileChange(change, false);
    expect(result.attribution).toEqual({
      agentId: 'agent-1',
      agentName: 'My Agent',
      sessionId: 'sess-1',
      turnNumber: 3,
      timestamp: 5000,
    });
  });

  it('handles added status', () => {
    const change = makeTrackedChange({ status: 'added' });
    expect(toUIFileChange(change, false).status).toBe('added');
  });

  it('handles deleted status', () => {
    const change = makeTrackedChange({ status: 'deleted' });
    expect(toUIFileChange(change, false).status).toBe('deleted');
  });

  it('handles renamed status', () => {
    const change = makeTrackedChange({ status: 'renamed' });
    expect(toUIFileChange(change, false).status).toBe('renamed');
  });

  it('handles undefined status', () => {
    const change = makeTrackedChange({ status: undefined });
    expect(toUIFileChange(change, false).status).toBeUndefined();
  });
});

