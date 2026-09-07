import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LineType } from '$shared/types';
import type { ChatFileChange } from '$lib/utils/get-file-changes-from-messages';
import {
  fromChatTurn,
  fromCommit,
  fromPullRequest,
  fromPullRequestRange,
  fromRange,
} from './index';

const mocks = vi.hoisted(() => ({
  commitDetails: vi.fn(),
  diffs: vi.fn(),
  backendRequest: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: { git: { commitDetails: mocks.commitDetails, diffs: mocks.diffs } },
}));

vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.backendRequest }));

const branchDiffFixture = [
  {
    file: 'src/changed.ts',
    oldContent: 'old value',
    newContent: 'new value\nextra value',
    chunks: [
      {
        oldStart: 4,
        oldLines: 1,
        newStart: 4,
        newLines: 2,
        lines: [
          { type: LineType.Deletion, content: 'old value' },
          { type: LineType.Addition, content: 'new value' },
          { type: LineType.Addition, content: 'extra value' },
        ],
      },
    ],
  },
];

describe('diff map source adapters', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds a commit document from commit details and git.diffs', async () => {
    mocks.commitDetails.mockResolvedValue({
      files: ['src/a.ts'],
      fileDetails: [{ path: 'src/a.ts', additions: 2, deletions: 1 }],
    });
    mocks.diffs.mockResolvedValue([
      {
        file: 'src/a.ts',
        chunks: [
          {
            oldStart: 4,
            oldLines: 1,
            newStart: 4,
            newLines: 2,
            lines: [
              { type: LineType.Deletion, content: 'old' },
              { type: LineType.Addition, content: 'new' },
              { type: LineType.Addition, content: 'newer' },
            ],
          },
        ],
      },
    ]);

    const document = await fromCommit('ws-1', 'abc123');

    expect(mocks.commitDetails).toHaveBeenCalledWith('ws-1', 'abc123');
    expect(mocks.diffs).toHaveBeenCalledWith('ws-1', { commitHash: 'abc123' });
    expect(document.source).toEqual({
      kind: 'commit',
      commitHash: 'abc123',
      snapshotId: 'abc123',
    });
    expect(document.files[0]).toMatchObject({
      path: 'src/a.ts',
      additions: 2,
      deletions: 1,
      status: 'modified',
    });
    expect(document.files[0].oldTrack).toBeDefined();
  });

  it('uses commit file status and rename facts when the caller has them', async () => {
    mocks.commitDetails.mockResolvedValue({ files: [], fileDetails: [] });
    mocks.diffs.mockResolvedValue([]);

    const document = await fromCommit('ws-1', 'abc123', [
      { path: 'src/added.ts', status: 'A', additions: 1, deletions: 0 },
      { path: 'src/deleted.ts', status: 'D', additions: 0, deletions: 1 },
      { path: 'src/modified.ts', status: 'M', additions: 1, deletions: 1 },
      {
        path: 'src/renamed.ts',
        status: 'R',
        renamedFrom: 'src/old.ts',
        additions: 0,
        deletions: 0,
      },
      { path: 'src/binary.dat', status: 'binary' },
      { path: 'src/mode.sh', status: 'mode', additions: 0, deletions: 0 },
    ]);

    expect(document.files.map((file) => file.status)).toEqual([
      'added',
      'binary',
      'deleted',
      'mode',
      'modified',
      'renamed',
    ]);
    expect(document.files.find((file) => file.status === 'renamed')).toMatchObject({
      path: 'src/renamed.ts',
      renamedFrom: 'src/old.ts',
    });
    expect(document.files.every((file) => file.attribution === undefined)).toBe(true);
  });

  it('keeps binary and deleted chunk-only commit files', async () => {
    mocks.commitDetails.mockResolvedValue(null);
    mocks.diffs.mockResolvedValue([
      { file: 'binary.dat', chunks: [], isBinary: true },
      {
        file: 'deleted.ts',
        chunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 0,
            newLines: 0,
            lines: [{ type: LineType.Deletion, content: 'gone' }],
          },
        ],
      },
    ]);

    const document = await fromCommit('ws-1', 'abc123');

    expect(document.files).toEqual([
      expect.objectContaining({ path: 'binary.dat', status: 'binary' }),
      expect.objectContaining({ path: 'deleted.ts', status: 'deleted', deletions: 1 }),
    ]);
  });

  it('preserves path-only commit details and empty commit responses', async () => {
    mocks.commitDetails.mockResolvedValue({ files: ['path-only.ts'], fileDetails: [] });
    mocks.diffs.mockResolvedValue([]);

    const partial = await fromCommit('ws-1', 'partial');
    expect(partial.files[0]).toMatchObject({
      path: 'path-only.ts',
      status: 'modified',
      statsKnown: false,
    });

    mocks.commitDetails.mockResolvedValue({ files: [], fileDetails: [] });
    expect((await fromCommit('ws-1', 'empty')).files).toEqual([]);
  });

  it('rejects when a commit backend call rejects', async () => {
    mocks.commitDetails.mockRejectedValue(new Error('commit details failed'));
    mocks.diffs.mockResolvedValue([]);

    await expect(fromCommit('ws-1', 'abc123')).rejects.toThrow('commit details failed');
  });

  it('builds a range document from branchDiff and numstat responses', async () => {
    mocks.backendRequest.mockImplementation((method: string) =>
      method === 'git.branchDiff'
        ? Promise.resolve(branchDiffFixture)
        : Promise.resolve([{ filePath: 'src/changed.ts', additions: 2, deletions: 1 }]),
    );

    const document = await fromRange('base-sha', 'head-sha', { workspaceId: 'ws-1' });

    const params = { workspaceId: 'ws-1', baseCommitSha: 'base-sha', targetRef: 'head-sha' };
    expect(mocks.backendRequest).toHaveBeenCalledWith('git.branchDiff', params);
    expect(mocks.backendRequest).toHaveBeenCalledWith('git.numstat', params);
    expect(document.source).toEqual({
      kind: 'range',
      base: 'base-sha',
      head: 'head-sha',
      snapshotId: 'base-sha..head-sha',
    });
    expect(document.files[0]).toMatchObject({
      path: 'src/changed.ts',
      status: 'modified',
      additions: 2,
      hunks: [{ oldRange: { start: 4, end: 4 }, newRange: { start: 4, end: 5 } }],
    });
    expect(document.files[0].oldTrack).toBeDefined();
    expect(document.files[0].newTrack).toBeDefined();
  });

  it('classifies content-backed range additions/deletions and keeps numstat-only files', async () => {
    mocks.backendRequest.mockImplementation((method: string) =>
      method === 'git.branchDiff'
        ? Promise.resolve([
            { file: 'a-empty.ts', oldContent: '', newContent: '', chunks: [] },
            { file: 'd-deleted.ts', oldContent: 'gone', newContent: '', chunks: [] },
            { file: 'm-modified.ts', oldContent: 'old', newContent: 'new', chunks: [] },
          ])
        : Promise.resolve([
            { filePath: 'a-empty.ts', additions: 0, deletions: 0 },
            { filePath: 'd-deleted.ts', additions: 0, deletions: 1 },
            { filePath: 'm-modified.ts', additions: 1, deletions: 1 },
            { filePath: 'n-numstat-only.ts', additions: 3, deletions: 0 },
          ]),
    );

    const document = await fromRange('base', 'head', { workspaceId: 'ws-1' });

    expect(
      document.files.map(({ path, status, additions, deletions }) => ({
        path,
        status,
        additions,
        deletions,
      })),
    ).toEqual([
      { path: 'a-empty.ts', status: 'unknown', additions: 0, deletions: 0 },
      { path: 'd-deleted.ts', status: 'deleted', additions: 0, deletions: 1 },
      { path: 'm-modified.ts', status: 'modified', additions: 1, deletions: 1 },
      { path: 'n-numstat-only.ts', status: 'unknown', additions: 3, deletions: 0 },
    ]);
  });

  it('keeps branchDiff-only files with unknown statistics', async () => {
    mocks.backendRequest.mockImplementation((method: string) =>
      method === 'git.branchDiff'
        ? Promise.resolve([{ file: 'only.ts', oldContent: '', newContent: 'new', chunks: [] }])
        : Promise.resolve([]),
    );

    expect((await fromRange('base', 'head', { workspaceId: 'ws-1' })).files[0]).toMatchObject({
      path: 'only.ts',
      status: 'added',
      statsKnown: false,
    });
  });

  it('returns an empty range document for empty backend responses', async () => {
    mocks.backendRequest.mockResolvedValue([]);

    expect((await fromRange('base', 'head', { workspaceId: 'ws-1' })).files).toEqual([]);
  });

  it('rejects when either range backend call rejects', async () => {
    mocks.backendRequest.mockImplementation((method: string) =>
      method === 'git.branchDiff'
        ? Promise.reject(new Error('branch diff failed'))
        : Promise.resolve([]),
    );

    await expect(fromRange('base', 'head', { workspaceId: 'ws-1' })).rejects.toThrow(
      'branch diff failed',
    );
  });

  it('builds a pull request document from the existing PR file list', () => {
    const document = fromPullRequest({
      repository: 'intent-hq/cloudlands-fe',
      number: 42,
      headSha: 'pr-head',
      files: [
        {
          path: 'src/pr.ts',
          additions: 5,
          deletions: 3,
          status: 'renamed',
          renamedFrom: 'src/old-pr.ts',
        },
      ],
    });

    expect(document.source).toEqual({
      kind: 'pr',
      repository: 'intent-hq/cloudlands-fe',
      prNumber: 42,
      snapshotId: 'pr-head',
    });
    expect(document.files[0]).toMatchObject({
      path: 'src/pr.ts',
      status: 'renamed',
      renamedFrom: 'src/old-pr.ts',
    });
    expect(document.files[0].attribution).toBeUndefined();
  });

  it('preserves every pull request status without a post-build override', () => {
    const statuses = ['added', 'modified', 'deleted', 'renamed', 'binary', 'mode'] as const;
    const document = fromPullRequest({
      repository: 'intent-hq/cloudlands-fe',
      number: 42,
      files: statuses.map((status, index) => ({
        path: `src/${index}.ts`,
        status,
        ...(status === 'renamed' ? { renamedFrom: 'src/old.ts' } : {}),
      })),
    });

    expect(document.files.map((file) => file.status)).toEqual(statuses);
    expect(document.files.every((file) => file.attribution === undefined)).toBe(true);
  });

  it('builds PR status from an authoritative base-to-head branch diff', async () => {
    mocks.backendRequest.mockResolvedValue([
      { file: 'new.ts', oldContent: '', newContent: 'created', chunks: [] },
    ]);

    const document = await fromPullRequestRange(
      {
        repository: 'intent-hq/cloudlands-fe',
        number: 42,
        files: [{ path: 'new.ts', additions: 1, deletions: 0 }],
      },
      { workspaceId: 'ws-1', baseRef: 'main', targetRef: 'HEAD' },
    );

    expect(mocks.backendRequest).toHaveBeenCalledWith('git.branchDiff', {
      workspaceId: 'ws-1',
      baseRef: 'main',
      targetRef: 'HEAD',
    });
    expect(document.files[0]).toMatchObject({ path: 'new.ts', status: 'added' });
  });

  it('keeps add-then-modify PR history classified as added from its net range', async () => {
    mocks.backendRequest.mockResolvedValue([
      { file: 'new.ts', oldContent: '', newContent: 'modified later', chunks: [] },
    ]);

    const document = await fromPullRequestRange(
      {
        repository: 'intent-hq/cloudlands-fe',
        number: 42,
        files: [{ path: 'new.ts', additions: 2, deletions: 1 }],
      },
      { workspaceId: 'ws-1', baseCommitSha: 'base-sha' },
    );

    expect(document.files[0]).toMatchObject({
      path: 'new.ts',
      additions: 2,
      deletions: 1,
      status: 'added',
    });
  });

  it('builds empty pull-request and chat-turn documents', () => {
    expect(
      fromPullRequest({ repository: 'intent-hq/cloudlands-fe', number: 42, files: [] }).files,
    ).toEqual([]);
    expect(fromChatTurn([], { sessionId: 'agent-1', turnId: 'turn-empty' }).files).toEqual([]);
  });

  it('builds a chat-turn document without backend reads', () => {
    const changes: ChatFileChange[] = [
      {
        filePath: 'src/chat.ts',
        action: 'modify',
        additions: 1,
        deletions: 1,
        toolName: 'str-replace-editor',
        toolCallId: 'tool-1',
      },
    ];

    const document = fromChatTurn(changes, { sessionId: 'agent-1', turnId: 'turn-7' });

    expect(document.source).toEqual({
      kind: 'chat-turn',
      sessionId: 'agent-1',
      turnId: 'turn-7',
      snapshotId: 'turn-7',
    });
    expect(document.files[0]).toMatchObject({ path: 'src/chat.ts', status: 'modified' });
    expect(mocks.backendRequest).not.toHaveBeenCalled();
  });

  it('maps every chat action through the builder', () => {
    const changes: ChatFileChange[] = [
      {
        filePath: 'a.ts',
        action: 'create',
        additions: 1,
        deletions: 0,
        toolName: 'save-file',
        toolCallId: '1',
      },
      {
        filePath: 'd.ts',
        action: 'delete',
        additions: 0,
        deletions: 1,
        toolName: 'remove-files',
        toolCallId: '2',
      },
      {
        filePath: 'm.ts',
        action: 'modify',
        additions: 1,
        deletions: 1,
        toolName: 'apply_patch',
        toolCallId: '3',
      },
    ];

    expect(
      fromChatTurn(changes, { sessionId: 'agent-1', turnId: 'turn-8' }).files.map(
        (file) => file.status,
      ),
    ).toEqual(['added', 'deleted', 'modified']);
  });
});
