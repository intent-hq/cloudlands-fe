import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LineType } from '$shared/types';
import type { ChatFileChange } from '$lib/utils/get-file-changes-from-messages';
import { fromChatTurn, fromCommit, fromPullRequest, fromRange } from './index';

const mocks = vi.hoisted(() => ({
  commitDetails: vi.fn(),
  diffs: vi.fn(),
  backendRequest: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: { git: { commitDetails: mocks.commitDetails, diffs: mocks.diffs } },
}));

vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.backendRequest }));

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

  it('builds a range document from branchDiff and numstat responses', async () => {
    mocks.backendRequest.mockImplementation((method: string) =>
      method === 'git.branchDiff'
        ? Promise.resolve([{ file: 'src/new.ts', oldContent: '', newContent: 'one\ntwo' }])
        : Promise.resolve([{ filePath: 'src/new.ts', additions: 2, deletions: 0 }]),
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
    expect(document.files[0]).toMatchObject({ path: 'src/new.ts', status: 'added', additions: 2 });
  });

  it('builds a pull request document from the existing PR file list', () => {
    const document = fromPullRequest({
      repository: 'intent-hq/cloudlands-fe',
      number: 42,
      headSha: 'pr-head',
      files: [{ path: 'src/pr.ts', additions: 5, deletions: 3, status: 'renamed' }],
    });

    expect(document.source).toEqual({
      kind: 'pr',
      repository: 'intent-hq/cloudlands-fe',
      prNumber: 42,
      snapshotId: 'pr-head',
    });
    expect(document.files[0]).toMatchObject({ path: 'src/pr.ts', status: 'renamed' });
    expect(document.files[0].attribution).toBeUndefined();
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
});
