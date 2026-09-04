/**
 * @vitest-environment jsdom
 */
import { m } from '$shared/paraglide/messages.js';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';
import type {
  LocalChangesRoot,
  LocalChangesWarning,
} from '$store/renderer/slices/workspace-operations/workspace-operations-types';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

const openExternalUrlMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/utils/open-external', () => ({ openExternalUrl: openExternalUrlMock }));

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../DeleteWarningDialog.svelte'));

describe('DeleteWarningDialog', () => {
  beforeEach(() => {
    openExternalUrlMock.mockClear();
  });

  it('shows a clear stop-and-delete action for spaces with running agents', async () => {
    const onDeleteAnyway = vi.fn();
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        agentNames: ['Agent One', 'Agent Two'],
        onDeleteAnyway,
      },
    });

    expect(
      await screen.findByRole('dialog', { name: m.modals_deleteWarning_title() }),
    ).toBeTruthy();
    expect(screen.getByText('Agent One')).toBeTruthy();
    expect(screen.getByText('Agent Two')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close delete warning dialog' })).toBeTruthy();

    const deleteButton = screen.getByRole('button', { name: 'Stop work and delete' });
    await waitFor(() => expect(document.activeElement).toBe(deleteButton));
    expect(deleteButton.className).toContain('ring-[3px]');
    expect(screen.getByRole('dialog').querySelector('.svelte-fa')).toBeNull();

    await fireEvent.click(deleteButton);

    expect(onDeleteAnyway).toHaveBeenCalledOnce();
  });

  it('lists active background hooks alongside agents', async () => {
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        agentNames: ['Agent One'],
        hookNames: ['ci-watch', 'pr-watch'],
      },
    });

    expect(screen.getByText('1 active agent will be stopped')).toBeTruthy();
    expect(screen.getByText('2 active background hooks will be cancelled')).toBeTruthy();
    expect(screen.getByText('ci-watch')).toBeTruthy();
    expect(screen.getByText('pr-watch')).toBeTruthy();
  });

  it('shows only the hooks section when hooks alone are active', async () => {
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        agentNames: [],
        hookNames: ['ci-watch'],
      },
    });

    expect(screen.getByText('1 active background hook will be cancelled')).toBeTruthy();
    expect(screen.queryByText(/active agent/)).toBeNull();
  });

  it('never renders a "0 active agents" line when both lists are empty', async () => {
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        agentNames: [],
        hookNames: [],
        openPrs: [],
      },
    });

    expect(screen.queryByText(/active agent/)).toBeNull();
    expect(screen.queryByText(/background hook/)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('lists open PRs with status badges and a conflict indicator', async () => {
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        openPrs: [
          {
            number: 12,
            title: 'Add feature',
            url: 'https://github.com/acme/repo/pull/12',
            status: 'Open' as const,
          },
          {
            number: 13,
            title: 'Draft feature',
            url: 'https://github.com/acme/repo/pull/13',
            status: 'Draft' as const,
            mergeConflicts: true,
          },
        ],
      },
    });

    expect(screen.getByText(m.modals_deleteWarning_openPrs_many({ count: '2' }))).toBeTruthy();
    expect(screen.getByRole('link', { name: '#12 Add feature' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '#13 Draft feature' })).toBeTruthy();
    expect(screen.getAllByText(m.workspace_prSection_statusOpen_label())).toHaveLength(1);
    expect(screen.getAllByText(m.workspace_prSection_statusDraft_label())).toHaveLength(1);
    expect(screen.getAllByText(m.modals_deleteWarning_prMergeConflicts_label())).toHaveLength(1);
  });

  it('opens a PR link externally instead of navigating the window', async () => {
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        openPrs: [
          {
            number: 7,
            title: 'Fix bug',
            url: 'https://github.com/acme/repo/pull/7',
            status: 'Open' as const,
          },
        ],
      },
    });

    const link = screen.getByRole('link', { name: '#7 Fix bug' });
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    await fireEvent(link, clickEvent);

    expect(openExternalUrlMock).toHaveBeenCalledWith('https://github.com/acme/repo/pull/7');
    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it('renders a URL-less PR as plain text instead of a link', async () => {
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        openPrs: [
          {
            number: 9,
            title: 'No url yet',
            url: '',
            status: 'Open' as const,
          },
        ],
      },
    });

    expect(screen.queryByRole('link')).toBeNull();
    const item = screen.getByText('#9 No url yet');
    await fireEvent.click(item);

    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it('renders the PR section in archive mode with no agents or hooks', async () => {
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        mode: 'archive' as const,
        openPrs: [
          {
            number: 42,
            title: 'Pending work',
            url: 'https://github.com/acme/repo/pull/42',
            status: 'Draft' as const,
          },
        ],
      },
    });

    expect(screen.getByText(m.modals_deleteWarning_openPrs_one({ count: '1' }))).toBeTruthy();
    expect(screen.getByRole('link', { name: '#42 Pending work' })).toBeTruthy();
    expect(screen.getByText(m.workspace_prSection_statusDraft_label())).toBeTruthy();
    expect(screen.queryByText(m.modals_deleteWarning_prMergeConflicts_label())).toBeNull();
  });

  it('renders archive copy and confirm label in archive mode', async () => {
    const onDeleteAnyway = vi.fn();
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        mode: 'archive' as const,
        agentNames: ['Agent One'],
        hookNames: ['ci-watch'],
        onDeleteAnyway,
      },
    });

    expect(
      await screen.findByRole('dialog', { name: m.modals_archiveWarning_title() }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close archive warning dialog' })).toBeTruthy();

    const archiveButton = screen.getByRole('button', { name: 'Stop work and archive' });
    await fireEvent.click(archiveButton);

    expect(onDeleteAnyway).toHaveBeenCalledOnce();
  });

  describe('local changes', () => {
    const primary = (over: Partial<LocalChangesRoot> = {}): LocalChangesRoot => ({
      kind: 'primary',
      path: '/home/u/ws/repo',
      branch: 'feat/x',
      hasRemoteRefs: true,
      unpushedCount: 0,
      uncommittedCount: 0,
      ...over,
    });
    const secondary = (over: Partial<LocalChangesRoot> = {}): LocalChangesRoot => ({
      kind: 'secondary',
      gitRootId: 'root-2',
      path: '/home/u/ws/repo/packages/lib',
      branch: 'main',
      hasRemoteRefs: true,
      unpushedCount: 0,
      uncommittedCount: 0,
      ...over,
    });
    const warning = (roots: LocalChangesRoot[]): LocalChangesWarning => ({
      roots,
      hasUnpushedCommits: roots.some((r) => r.unpushedCount > 0),
      hasUncommittedChanges: roots.some((r) => r.uncommittedCount > 0),
    });

    it('renders no local-changes section when there is no local work', async () => {
      const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

      render(DeleteWarningDialog, {
        props: { open: true, localChanges: warning([primary()]) },
      });

      expect(screen.queryByText(m.modals_deleteWarning_localChanges_description())).toBeNull();
      expect(screen.queryByText('feat/x')).toBeNull();
      expect(screen.queryByText(/unpushed commit/)).toBeNull();
      expect(
        screen.queryByText(m.modals_deleteWarning_localChanges_uncommitted_label()),
      ).toBeNull();
    });

    it('renders no local-changes section when the result is null (fail-open)', async () => {
      const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

      render(DeleteWarningDialog, {
        props: { open: true, agentNames: ['Agent One'], localChanges: null },
      });

      expect(screen.getByText('Agent One')).toBeTruthy();
      expect(screen.queryByText(m.modals_deleteWarning_localChanges_description())).toBeNull();
    });

    it('lists unpushed commits on the primary root labelled by branch', async () => {
      const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

      render(DeleteWarningDialog, {
        props: { open: true, localChanges: warning([primary({ unpushedCount: 3 })]) },
      });

      expect(screen.getByText(m.modals_deleteWarning_localChanges_description())).toBeTruthy();
      expect(screen.getByText('feat/x')).toBeTruthy();
      expect(
        screen.getByText(m.modals_deleteWarning_localChanges_unpushed_many({ count: '3' })),
      ).toBeTruthy();
      expect(
        screen.queryByText(m.modals_deleteWarning_localChanges_uncommitted_label()),
      ).toBeNull();
    });

    it('lists uncommitted changes only, without an unpushed count', async () => {
      const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

      render(DeleteWarningDialog, {
        props: { open: true, localChanges: warning([primary({ uncommittedCount: 2 })]) },
      });

      expect(screen.getByText('feat/x')).toBeTruthy();
      expect(
        screen.getByText(m.modals_deleteWarning_localChanges_uncommitted_label()),
      ).toBeTruthy();
      expect(screen.queryByText(/unpushed commit/)).toBeNull();
    });

    it('lists the primary and a secondary root (basename + branch) as separate rows', async () => {
      const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

      render(DeleteWarningDialog, {
        props: {
          open: true,
          localChanges: warning([
            primary({ unpushedCount: 1 }),
            secondary({ unpushedCount: 2, uncommittedCount: 1 }),
          ]),
        },
      });

      expect(screen.getByText('feat/x')).toBeTruthy();
      expect(
        screen.getByText(
          m.modals_deleteWarning_localChanges_secondaryRoot_label({
            name: 'lib',
            branch: 'main',
          }),
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(m.modals_deleteWarning_localChanges_unpushed_one({ count: '1' })),
      ).toBeTruthy();
      expect(
        screen.getByText(m.modals_deleteWarning_localChanges_unpushed_many({ count: '2' })),
      ).toBeTruthy();
      expect(
        screen.getAllByText(m.modals_deleteWarning_localChanges_uncommitted_label()),
      ).toHaveLength(1);
    });

    it('skips roots the daemon could not read', async () => {
      const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

      render(DeleteWarningDialog, {
        props: {
          open: true,
          localChanges: warning([
            primary({ unpushedCount: 1 }),
            secondary({ path: '/home/u/ws/broken', error: 'not a git repository' }),
          ]),
        },
      });

      expect(screen.getByText('feat/x')).toBeTruthy();
      expect(screen.queryByText(/broken/)).toBeNull();
      expect(screen.queryByText(/not a git repository/)).toBeNull();
    });

    it('uses the archive copy in archive mode and the delete copy otherwise', async () => {
      const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

      const { unmount } = render(DeleteWarningDialog, {
        props: {
          open: true,
          mode: 'archive' as const,
          localChanges: warning([primary({ uncommittedCount: 1 })]),
        },
      });

      expect(screen.getByText(m.modals_archiveWarning_localChanges_description())).toBeTruthy();
      expect(screen.queryByText(m.modals_deleteWarning_localChanges_description())).toBeNull();
      unmount();

      render(DeleteWarningDialog, {
        props: { open: true, localChanges: warning([primary({ uncommittedCount: 1 })]) },
      });

      expect(screen.getByText(m.modals_deleteWarning_localChanges_description())).toBeTruthy();
      expect(screen.queryByText(m.modals_archiveWarning_localChanges_description())).toBeNull();
    });
  });

  it('cancels the dialog when Escape is pressed inside the dialog', async () => {
    const onCancel = vi.fn();
    const DeleteWarningDialog = (await import('../DeleteWarningDialog.svelte')).default;

    render(DeleteWarningDialog, {
      props: {
        open: true,
        agentNames: ['Agent One'],
        onCancel,
      },
    });

    const dialog = await screen.findByRole('dialog', {
      name: m.modals_deleteWarning_title(),
    });

    await fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
