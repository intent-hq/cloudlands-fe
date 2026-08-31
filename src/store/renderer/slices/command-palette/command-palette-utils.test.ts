/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import {
  fuzzyScore,
  scoreItemFields,
  formatRelativeTime,
  parseQueryFilter,
  buildNoteBreadcrumbs,
  buildMessageTitleSegments,
  buildRecentItems,
  type WorkspaceObject,
} from './command-palette-utils';
import { WorkspaceStatus, type Note } from '$shared/types';

// ── fuzzyScore ─────────────────────────────────────────────────────────────

describe('fuzzyScore', () => {
  it('returns 0 for empty needle', () => {
    expect(fuzzyScore('hello', '')).toBe(0);
  });

  it('returns 1000 for exact match', () => {
    expect(fuzzyScore('hello', 'hello')).toBe(1000);
  });

  it('returns high score for prefix match', () => {
    const score = fuzzyScore('hello world', 'hello');
    expect(score).toBeGreaterThan(100);
  });

  it('returns -Infinity for non-subsequence', () => {
    expect(fuzzyScore('abc', 'xyz')).toBe(-Infinity);
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('Hello', 'hello')).toBe(1000);
  });

  it('scores word-boundary matches higher', () => {
    const boundaryScore = fuzzyScore('my-file-name', 'mfn');
    const midScore = fuzzyScore('amxfxnyz', 'mfn');
    expect(boundaryScore).toBeGreaterThan(midScore);
  });

  it('ranks a word-boundary substring above a scattered subsequence', () => {
    const substringScore = fuzzyScore('Open HUD ', 'hud');
    const scatteredScore = fuzzyScore('Hardware update discussion some note description', 'hud');
    expect(substringScore).toBeGreaterThan(scatteredScore);
  });

  it('ranks a plain substring above a scattered subsequence', () => {
    const substringScore = fuzzyScore('shudder', 'hud');
    const scatteredScore = fuzzyScore('Hardware update discussion some note description', 'hud');
    expect(substringScore).toBeGreaterThan(scatteredScore);
  });

  it('ranks a word-boundary substring above a plain substring', () => {
    expect(fuzzyScore('Open HUD ', 'hud')).toBeGreaterThan(fuzzyScore('shudder', 'hud'));
  });

  it('still ranks a prefix match above a substring match', () => {
    expect(fuzzyScore('hud panel', 'hud')).toBeGreaterThan(fuzzyScore('Open HUD ', 'hud'));
  });

  it('still ranks an exact match above everything', () => {
    expect(fuzzyScore('hud', 'hud')).toBe(1000);
    expect(fuzzyScore('hud', 'hud')).toBeGreaterThan(fuzzyScore('hud panel', 'hud'));
  });

  it('prefers a later word-boundary occurrence over an earlier plain occurrence', () => {
    expect(fuzzyScore('shud HUD', 'hud')).toBe(122);
    expect(fuzzyScore('shud HUD', 'hud')).toBeGreaterThan(fuzzyScore('shudder', 'hud'));
  });

  it('ranks a contiguous substring above any pure subsequence match for long needles', () => {
    const contiguous = fuzzyScore('zzabcdefghijklmnop', 'abcdefghijklmnop');
    const scattered = fuzzyScore('za b c d e f g h i j k l m n o p', 'abcdefghijklmnop');
    expect(contiguous).toBeGreaterThan(scattered);
    expect(scattered).toBeLessThan(50);
  });
});

// ── scoreItemFields ────────────────────────────────────────────────────────

describe('scoreItemFields', () => {
  it('returns 0 for an empty query', () => {
    expect(scoreItemFields({ label: 'anything' }, '')).toBe(0);
    expect(scoreItemFields({ label: 'anything' }, '   ')).toBe(0);
  });

  it('matches multi-word queries regardless of token order', () => {
    const label = 'Improve cmd+k search ranking';
    const forward = scoreItemFields({ label }, 'cmd search');
    const reversed = scoreItemFields({ label }, 'search cmd');
    expect(forward).toBeGreaterThan(0);
    expect(reversed).toBeGreaterThan(0);
    expect(reversed).toBe(forward);
  });

  it('dedupes repeated query tokens so scores are query-idempotent', () => {
    const label = 'Improve cmd+k search ranking';
    expect(scoreItemFields({ label }, 'cmd cmd')).toBe(scoreItemFields({ label }, 'cmd'));
  });

  it('gives a strong score when every token substring-matches the label', () => {
    const score = scoreItemFields({ label: 'Improve cmd+k search ranking' }, 'search cmd');
    // Both tokens are word-boundary substrings of the label (>= 100 each).
    expect(score).toBeGreaterThan(200);
  });

  it('returns -Infinity when any token matches no field (AND semantics)', () => {
    expect(
      scoreItemFields(
        { label: 'Improve cmd+k search ranking', description: 'palette scoring' },
        'search zzzqqq',
      ),
    ).toBe(-Infinity);
  });

  it('lets a token match the description when the label misses', () => {
    const score = scoreItemFields(
      { label: 'Open settings', description: 'keyboard shortcuts' },
      'settings keyboard',
    );
    expect(score).toBeGreaterThan(0);
  });

  it('lets a token match searchText when label and description miss', () => {
    const score = scoreItemFields(
      { label: 'Open settings', searchText: 'preferences config' },
      'config',
    );
    expect(score).toBeGreaterThan(0);
  });

  it('ranks a label match above the same match in the description', () => {
    const labelMatch = scoreItemFields(
      { label: 'search ranking', description: 'unrelated' },
      'search',
    );
    const descriptionMatch = scoreItemFields(
      { label: 'unrelated thing', description: 'search ranking' },
      'search',
    );
    expect(labelMatch).toBeGreaterThan(descriptionMatch);
  });

  it('scores fields separately rather than a concatenated haystack', () => {
    // "labeltail" would subsequence-match across a "label tail" concatenation
    // of label + description, but matches neither field alone.
    expect(scoreItemFields({ label: 'label', description: 'tail' }, 'labeltail')).toBe(-Infinity);
  });

  it('preserves fuzzyScore ordering for single-token queries against the label', () => {
    const rank = (label: string) => scoreItemFields({ label }, 'hud');
    const exact = rank('hud');
    const prefix = rank('hud panel');
    const boundary = rank('Open HUD ');
    const substring = rank('shudder');
    const subsequence = rank('Hardware update discussion some note description');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(boundary);
    expect(boundary).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
    expect(exact).toBe(fuzzyScore('hud', 'hud'));
    expect(prefix).toBe(fuzzyScore('hud panel', 'hud'));
  });
});

// ── parseQueryFilter ───────────────────────────────────────────────────────

describe('parseQueryFilter', () => {
  it('returns null filter for empty query', () => {
    expect(parseQueryFilter('')).toEqual({ filter: null, searchTerm: '' });
  });

  it('detects @ prefix as agent filter', () => {
    expect(parseQueryFilter('@search')).toEqual({ filter: 'agent', searchTerm: 'search' });
  });

  it('detects # prefix as note filter', () => {
    expect(parseQueryFilter('# my note')).toEqual({ filter: 'note', searchTerm: 'my note' });
  });

  it('returns null filter for normal text', () => {
    expect(parseQueryFilter('hello')).toEqual({ filter: null, searchTerm: 'hello' });
  });

  it('detects all prefix types', () => {
    expect(parseQueryFilter('>cmd').filter).toBe('terminal');
    expect(parseQueryFilter('~diff').filter).toBe('change');
    expect(parseQueryFilter('/path').filter).toBe('file');
    expect(parseQueryFilter('*ws').filter).toBe('workspace');
    expect(parseQueryFilter('^url').filter).toBe('browser');
    expect(parseQueryFilter('?hello').filter).toBe('message');
  });
});

// ── formatRelativeTime ─────────────────────────────────────────────────────

describe('formatRelativeTime', () => {
  it('returns empty string for undefined', () => {
    expect(formatRelativeTime(undefined)).toBe('');
  });

  it('returns empty string for the epoch-0 placeholder (unknown attribution time)', () => {
    expect(formatRelativeTime(0)).toBe('');
  });

  it("returns 'now' for recent timestamps", () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('now');
  });

  it('formats real numeric epoch-millisecond timestamps', () => {
    expect(formatRelativeTime(Date.now())).toBe('now');
  });

  it('returns minutes ago for recent past', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago');
  });
});

// ── buildNoteBreadcrumbs ───────────────────────────────────────────────────

describe('buildNoteBreadcrumbs', () => {
  it('returns empty string for root note', () => {
    const note = { id: 'n1', title: 'Root' } as Note;
    expect(buildNoteBreadcrumbs(note, [note])).toBe('');
  });

  it('builds parent chain', () => {
    const parent = { id: 'p1', title: 'Parent' } as Note;
    const child = { id: 'c1', title: 'Child', parentId: 'p1' } as Note;
    expect(buildNoteBreadcrumbs(child, [parent, child])).toBe('Parent');
  });

  it('builds multi-level chain', () => {
    const gp = { id: 'gp', title: 'Grandparent' } as Note;
    const p = { id: 'p', title: 'Parent', parentId: 'gp' } as Note;
    const c = { id: 'c', title: 'Child', parentId: 'p' } as Note;
    expect(buildNoteBreadcrumbs(c, [gp, p, c])).toBe('Grandparent / Parent');
  });
});

// ── buildRecentItems ───────────────────────────────────────────────────────

describe('buildRecentItems', () => {
  it('returns empty when no MRU data', () => {
    const objects: WorkspaceObject[] = [{ id: 'a1', type: 'agent', label: 'Agent 1', icon: null }];
    expect(buildRecentItems(objects, [])).toEqual([]);
  });

  it('matches MRU entries to workspace objects', () => {
    const objects: WorkspaceObject[] = [{ id: 'a1', type: 'agent', label: 'Agent 1', icon: null }];
    const recent = buildRecentItems(objects, [{ type: 'agent', id: 'a1', timestamp: 100 }]);
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe('a1');
  });

  it('skips stale MRU entries before capping recent items', () => {
    const objects: WorkspaceObject[] = [
      { id: 'a1', type: 'agent', label: 'Agent 1', icon: null },
      { id: 'a2', type: 'agent', label: 'Agent 2', icon: null },
      { id: 'a3', type: 'agent', label: 'Agent 3', icon: null },
    ];
    const recent = buildRecentItems(objects, [
      { type: 'agent', id: 'missing', timestamp: 400 },
      { type: 'agent', id: 'a1', timestamp: 300 },
      { type: 'agent', id: 'a2', timestamp: 200 },
      { type: 'agent', id: 'a3', timestamp: 100 },
    ]);

    expect(recent.map((item) => item.id)).toEqual(['a1', 'a2', 'a3']);
  });
});

// ── buildMessageTitleSegments ──────────────────────────────────────────────

describe('buildMessageTitleSegments', () => {
  it('returns no segments for an unknown workspace', () => {
    expect(buildMessageTitleSegments(undefined)).toEqual({});
  });

  it('returns workspace title and owner/repo when fully populated', () => {
    expect(
      buildMessageTitleSegments({
        id: 'ws-1',
        title: 'Repo overview',
        repositoryOwner: 'panghy',
        repositoryName: 'chinese-fonts',
      }),
    ).toEqual({ workspaceName: 'Repo overview', repoLabel: 'panghy/chinese-fonts' });
  });

  it('returns just the repo name when the owner is missing', () => {
    expect(
      buildMessageTitleSegments({ id: 'ws-1', title: 'Local space', repositoryName: 'tools' }),
    ).toEqual({ workspaceName: 'Local space', repoLabel: 'tools' });
  });

  it('omits the repo label when the repository name is missing', () => {
    expect(
      buildMessageTitleSegments({ id: 'ws-1', title: 'No repo', repositoryOwner: 'panghy' }),
    ).toEqual({ workspaceName: 'No repo', repoLabel: undefined });
  });

  it('falls back to the workspace id when the title is empty', () => {
    expect(buildMessageTitleSegments({ id: 'ws-1', title: '' })).toEqual({
      workspaceName: 'ws-1',
      repoLabel: undefined,
    });
  });

  it('flags an archived workspace', () => {
    expect(
      buildMessageTitleSegments({
        id: 'ws-1',
        title: 'Old space',
        status: WorkspaceStatus.Archived,
      }),
    ).toEqual({ workspaceName: 'Old space', repoLabel: undefined, isArchivedWorkspace: true });
  });

  it('does not flag an active workspace', () => {
    expect(
      buildMessageTitleSegments({
        id: 'ws-1',
        title: 'Live space',
        status: WorkspaceStatus.Active,
      }).isArchivedWorkspace,
    ).toBeUndefined();
  });

  it('does not flag a workspace without a status', () => {
    expect(
      buildMessageTitleSegments({ id: 'ws-1', title: 'No status' }).isArchivedWorkspace,
    ).toBeUndefined();
  });
});
