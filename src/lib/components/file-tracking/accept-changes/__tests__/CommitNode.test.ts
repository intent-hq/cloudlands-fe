/**
 * @vitest-environment jsdom
 *
 * CommitNode lazy file loading: `accept-changes.getStatus` ships metadata-only
 * commits (no `files`/`filesChanged`, PROTOCOL §5.18), so CommitNode fetches
 * per-file data via `git.commitDetails` (PROTOCOL §5.6) on first expand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import CommitNode from '../CommitNode.svelte';
import type { LocalCommitInfo } from '$features/accept-changes/types';

const mocks = vi.hoisted(() => ({
  mockCommitDetails: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    git: {
      commitDetails: mocks.mockCommitDetails,
    },
  },
}));

// PROTOCOL §5.18: metadata-only CommitWithAttribution (no files/filesChanged).
const metadataOnlyCommit: LocalCommitInfo = {
  hash: 'abc1234def5678',
  message: 'feat: add widget',
  author: 'Test',
  date: '2026-07-21T00:00:00Z',
  isPushed: false,
};

// PROTOCOL §5.6: flattened git.commitDetails result.
const commitDetailsResult = {
  commitHash: 'abc1234def5678',
  author: 'Test',
  authorEmail: 'test@example.com',
  date: '2026-07-21T00:00:00Z',
  message: 'feat: add widget',
  files: ['src/widget.ts'],
  fileDetails: [{ path: 'src/widget.ts', additions: 5, deletions: 2 }],
};

describe('CommitNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('fetches git.commitDetails on first expand for metadata-only commits', async () => {
    mocks.mockCommitDetails.mockResolvedValue(commitDetailsResult);

    render(CommitNode, { props: { commit: metadataOnlyCommit, workspaceId: 'ws-1' } });
    expect(mocks.mockCommitDetails).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByText('feat: add widget'));

    expect(mocks.mockCommitDetails).toHaveBeenCalledWith('ws-1', 'abc1234def5678');
    // FileRow renders the filename and directory separately.
    await waitFor(() => {
      expect(screen.getByText('widget.ts')).toBeTruthy();
    });
  });

  it('does not refetch on re-expand', async () => {
    mocks.mockCommitDetails.mockResolvedValue(commitDetailsResult);

    render(CommitNode, { props: { commit: metadataOnlyCommit, workspaceId: 'ws-1' } });
    const header = screen.getByText('feat: add widget');
    await fireEvent.click(header);
    await fireEvent.click(header);
    await fireEvent.click(header);

    expect(mocks.mockCommitDetails).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when commit already has files', async () => {
    const withFiles: LocalCommitInfo = {
      ...metadataOnlyCommit,
      filesChanged: 1,
      files: [{ path: 'a.ts', additions: 1, deletions: 0 }],
    };
    render(CommitNode, { props: { commit: withFiles, workspaceId: 'ws-1' } });

    await fireEvent.click(screen.getByText('feat: add widget'));

    expect(mocks.mockCommitDetails).not.toHaveBeenCalled();
    expect(screen.getByText('a.ts')).toBeTruthy();
  });

  it('does not fetch without a workspaceId and renders no file list', async () => {
    render(CommitNode, { props: { commit: metadataOnlyCommit } });

    await fireEvent.click(screen.getByText('feat: add widget'));

    expect(mocks.mockCommitDetails).not.toHaveBeenCalled();
  });

  it('degrades gracefully when commitDetails resolves null', async () => {
    mocks.mockCommitDetails.mockResolvedValue(null);

    render(CommitNode, { props: { commit: metadataOnlyCommit, workspaceId: 'ws-1' } });
    await fireEvent.click(screen.getByText('feat: add widget'));

    expect(mocks.mockCommitDetails).toHaveBeenCalledTimes(1);
    // No file rows; component still renders the header.
    expect(screen.getByText('feat: add widget')).toBeTruthy();
  });

  it('fetches immediately when defaultExpanded', async () => {
    mocks.mockCommitDetails.mockResolvedValue(commitDetailsResult);

    render(CommitNode, {
      props: { commit: metadataOnlyCommit, workspaceId: 'ws-1', defaultExpanded: true },
    });

    await waitFor(() => {
      expect(mocks.mockCommitDetails).toHaveBeenCalledWith('ws-1', 'abc1234def5678');
      expect(screen.getByText('widget.ts')).toBeTruthy();
    });
  });
});
