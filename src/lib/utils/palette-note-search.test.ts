import { describe, expect, it } from 'vitest';
import { WorkspaceStatus } from '$shared/types';
import {
  adaptNoteSearchResponse,
  type IndexedNoteMatch,
  type IndexedNoteSearchResponse,
} from './palette-note-search';
const match = (overrides: Partial<IndexedNoteMatch> = {}): IndexedNoteMatch => ({
  noteId: 'spec',
  workspaceId: 'workspace-a',
  title: 'Search plan',
  preview: 'A body-only match for wombat.',
  score: 1.25,
  updatedAt: '2026-10-01T01:00:00Z',
  isArchived: false,
  workspaceArchived: false,
  ...overrides,
});
const indexed = (matches: IndexedNoteMatch[] = [match()]): IndexedNoteSearchResponse => ({
  requestId: 'daemon-generated-request',
  indexed: true,
  matches,
});

describe('indexed note response adapter', () => {
  it('maps wire metadata and plain-text snippets with accessible workspace labels', () => {
    const update = adaptNoteSearchResponse(
      indexed([
        match({
          preview: '<script>alert("note")</script> **wombat** & text',
          workspaceArchived: true,
          isArchived: true,
        }),
      ]),
      [
        {
          id: 'workspace-a',
          title: 'Research',
          repositoryOwner: 'intent-hq',
          repositoryName: 'intent',
        },
      ],
    );
    expect(update).toEqual({
      loading: false,
      capability: 'indexed',
      fallback: false,
      items: [
        {
          id: '["workspace-a","spec"]',
          type: 'note',
          noteId: 'spec',
          workspaceId: 'workspace-a',
          label: 'Search plan',
          description: '<script>alert("note")</script> **wombat** & text',
          score: 1.25,
          updatedAt: '2026-10-01T01:00:00Z',
          isArchived: true,
          isArchivedWorkspace: true,
          workspaceName: 'Research',
          repoLabel: 'intent-hq/intent',
        },
      ],
    });
  });

  it('keeps backend archive state when workspace metadata is stale or unavailable', () => {
    const { items } = adaptNoteSearchResponse(
      indexed([match(), match({ workspaceId: 'missing', workspaceArchived: true })]),
      [{ id: 'workspace-a', repositoryName: 'intent', status: WorkspaceStatus.Archived }],
    );
    expect(items[0]).toMatchObject({
      workspaceName: 'workspace-a',
      repoLabel: 'intent',
      isArchivedWorkspace: false,
    });
    expect(items[1]).toMatchObject({ workspaceId: 'missing', isArchivedWorkspace: true });
    expect(items[1].workspaceName).toBeUndefined();
  });

  it('preserves rank order and enforces the ten-result cap without sorting by title or score', () => {
    const { items } = adaptNoteSearchResponse(
      indexed(
        Array.from({ length: 12 }, (_, index) =>
          match({ noteId: `note-${index}`, title: index === 0 ? 'Z' : 'A', score: index }),
        ),
      ),
      [],
    );
    expect(items.map((item) => item.noteId)).toEqual([
      'note-0',
      'note-1',
      'note-2',
      'note-3',
      'note-4',
      'note-5',
      'note-6',
      'note-7',
      'note-8',
      'note-9',
    ]);
  });

  it('keeps identical note IDs distinct across workspaces and delimiter-containing IDs', () => {
    const { items } = adaptNoteSearchResponse(
      indexed([
        match(),
        match({ workspaceId: 'workspace-b' }),
        match({ workspaceId: 'a:b', noteId: 'c' }),
        match({ workspaceId: 'a', noteId: 'b:c' }),
      ]),
      [],
    );
    expect(items.map((item) => [item.workspaceId, item.noteId])).toEqual([
      ['workspace-a', 'spec'],
      ['workspace-b', 'spec'],
      ['a:b', 'c'],
      ['a', 'b:c'],
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(4);
  });

  it('recognizes indexed capability with zero matches', () => {
    expect(adaptNoteSearchResponse(indexed([]), [])).toEqual({
      items: [],
      loading: false,
      capability: 'indexed',
      fallback: false,
    });
  });

  it.each([
    { matches: [] },
    { matches: [{ noteId: 'spec', preview: 'legacy hit', score: null }] },
    { indexed: false, matches: [match()] },
    { indexed: 'true', matches: [match()] },
    { matches: [match()] },
  ])(
    'uses fallback without guessing workspace ownership for missing/old markers: %j',
    (response) => {
      expect(adaptNoteSearchResponse(response, [{ id: 'active-workspace' }])).toEqual({
        items: [],
        loading: false,
        capability: 'legacy',
        fallback: true,
      });
    },
  );

  it.each([
    { indexed: true },
    { indexed: true, matches: [{ noteId: 'spec', preview: 'not a complete indexed hit' }] },
    indexed([match({ workspaceId: '' })]),
  ])('rejects a malformed indexed response without inventing identity: %j', (response) => {
    expect(() => adaptNoteSearchResponse(response, [{ id: 'active-workspace' }])).toThrow(
      TypeError,
    );
  });
});
