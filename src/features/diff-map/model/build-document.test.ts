import { describe, expect, it } from 'vitest';
import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
import type { ChatFileChange } from '$lib/utils/get-file-changes-from-messages';
import { buildDiffMapDocument } from './build-document';
import { diffMapFixtures, edgeDiffMapFixture, monorepoDiffMapFixture } from './fixtures';

function tracked(path: string, additions = 1, deletions = 1): TrackedChange {
  return {
    id: `input:${path}`,
    file: path,
    relativePath: path,
    stage: ChangeStage.Unstaged,
    status: 'modified',
    stats: { additions, deletions },
    attribution: { timestamp: 0 },
  };
}

const source = { kind: 'working-tree', workspaceId: 'test', snapshotId: 'snapshot' } as const;

describe('buildDiffMapDocument', () => {
  it('fuses single-child directory chains into a full-path group', () => {
    const document = buildDiffMapDocument(
      [tracked('src/features/diff-map/model/a.ts'), tracked('src/features/diff-map/model/b.ts')],
      { source },
    );

    expect(document.groups).toEqual([
      {
        id: 'src/features/diff-map/model',
        path: 'src/features/diff-map/model',
        displayPrefix: 'src/features/diff-map/',
        displayName: 'model',
        fileIds: ['src/features/diff-map/model/a.ts', 'src/features/diff-map/model/b.ts'],
        changedCount: 2,
      },
    ]);
  });

  it('detects sections at the first branching directory below a common root', () => {
    expect(monorepoDiffMapFixture.document.sections?.map((section) => section.path)).toEqual([
      'packages/cloudlands-fe',
      'packages/intentd',
    ]);
    expect(
      monorepoDiffMapFixture.document.sections?.map((section) => section.changedCount),
    ).toEqual([3, 3]);
  });

  it('separates the dimmed path prefix from the directory name', () => {
    const document = buildDiffMapDocument([tracked('src/lib/auth/access.ts')], { source });

    expect(document.groups[0]).toMatchObject({
      path: 'src/lib/auth',
      displayPrefix: 'src/lib/',
      displayName: 'auth',
    });
  });

  it('normalizes hunk positions and weights on independent old and new axes', () => {
    const patch = `@@ -1,2 +2,4 @@
-old
+new
@@ -9,2 +15,1 @@
-old
+new`;
    const document = buildDiffMapDocument([tracked('src/file.ts')], {
      source,
      patches: new Map([['src/file.ts', patch]]),
    });
    const file = document.files[0];

    expect(file.oldTrack).toHaveLength(4);
    expect(file.newTrack).toHaveLength(4);
    expect(file.oldTrack?.[0]).toBeCloseTo(0.0556, 4);
    expect(file.oldTrack?.[1]).toBeCloseTo(0.2, 4);
    expect(file.newTrack?.[0]).toBeCloseTo(0.1786, 4);
    expect(file.newTrack?.[1]).toBeCloseTo(0.2667, 4);
    expect([...file.oldTrack!, ...file.newTrack!].every((value) => value >= 0 && value <= 1)).toBe(
      true,
    );
  });

  it('omits ranges and tracks for zero-length hunk sides', () => {
    const document = buildDiffMapDocument(
      [tracked('src/added.ts', 3, 0), tracked('src/deleted.ts', 0, 2)],
      {
        source,
        patches: new Map([
          ['src/added.ts', '@@ -0,0 +1,3 @@'],
          ['src/deleted.ts', '@@ -4,2 +3,0 @@'],
        ]),
      },
    );

    expect(document.files[0]).toMatchObject({
      hunks: [{ newRange: { start: 1, end: 3 } }],
      newTrack: expect.any(Array),
    });
    expect(document.files[0].hunks?.[0]).not.toHaveProperty('oldRange');
    expect(document.files[0].oldTrack).toBeUndefined();
    expect(document.files[1]).toMatchObject({
      hunks: [{ oldRange: { start: 4, end: 5 } }],
      oldTrack: expect.any(Array),
    });
    expect(document.files[1].hunks?.[0]).not.toHaveProperty('newRange');
    expect(document.files[1].newTrack).toBeUndefined();
  });

  it('adapts chat file changes without manufacturing attribution', () => {
    const chatChange: ChatFileChange = {
      filePath: 'src/chat-created.ts',
      action: 'create',
      additions: 3,
      deletions: 0,
      toolName: 'save-file',
      toolCallId: 'tool-1',
    };
    const file = buildDiffMapDocument([chatChange], {
      source: { kind: 'chat-turn', sessionId: 'agent-1', turnId: 'turn-2', snapshotId: 's1' },
    }).files[0];

    expect(file).toMatchObject({
      id: 'src/chat-created.ts',
      status: 'added',
      additions: 3,
      deletions: 0,
      statsKnown: true,
    });
    expect(file.attribution).toBeUndefined();
  });

  it('only includes repository totals when a matching tree is supplied', () => {
    const withoutTree = buildDiffMapDocument([tracked('src/lib/format.ts')], { source });
    const withTree = diffMapFixtures[0].document;

    expect(withoutTree.groups[0].totalCount).toBeUndefined();
    expect(withTree.groups.find((group) => group.path === 'src/lib')?.totalCount).toBe(2);
  });

  it('preserves unknown statistics without presenting them as known zeroes', () => {
    const unknown = tracked('src/unknown.ts') as TrackedChange & {
      stats: { additions: undefined; deletions: undefined };
    };
    unknown.stats = { additions: undefined, deletions: undefined };
    const file = buildDiffMapDocument([unknown], { source }).files[0];

    expect(file).toMatchObject({ additions: 0, deletions: 0, statsKnown: false });
  });

  it('invalidates content hashes across snapshots when numstat is unchanged', () => {
    const change = tracked('src/revised.ts', 2, 1);
    const first = buildDiffMapDocument([change], {
      source: { ...source, snapshotId: 'snapshot-1' },
    });
    const second = buildDiffMapDocument([change], {
      source: { ...source, snapshotId: 'snapshot-2' },
    });

    expect(second.files[0].contentHash).not.toBe(first.files[0].contentHash);
  });

  it('keeps file and group identities stable in repository order', () => {
    const changes = [tracked('z/b.ts'), tracked('a/c.ts'), tracked('a/a.ts')];
    const first = buildDiffMapDocument(changes, { source });
    const second = buildDiffMapDocument([...changes].reverse(), { source });

    expect(first.files.map((file) => file.id)).toEqual(['a/a.ts', 'a/c.ts', 'z/b.ts']);
    expect(second.files.map((file) => file.id)).toEqual(first.files.map((file) => file.id));
    expect(second.groups.map((group) => group.id)).toEqual(first.groups.map((group) => group.id));
  });

  it('builds every deterministic fixture and preserves edge-case facts', () => {
    expect(diffMapFixtures.map((fixture) => fixture.document.files.length)).toEqual([
      3, 24, 120, 600, 6, 6,
    ]);
    expect(edgeDiffMapFixture.document.files.map((file) => file.status)).toEqual([
      'deleted',
      'mode',
      'binary',
      'renamed',
      'modified',
      'modified',
    ]);
    expect(
      edgeDiffMapFixture.document.files.find((file) => file.status === 'renamed'),
    ).toMatchObject({ renamedFrom: 'edge/old-name.ts' });
    expect(edgeDiffMapFixture.document.files.some((file) => file.name.length === 90)).toBe(true);
  });
});
