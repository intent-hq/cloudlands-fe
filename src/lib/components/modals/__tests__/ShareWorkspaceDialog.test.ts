/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { WorkspaceInvite, WorkspaceMember } from '$features/workspace-sharing/types';
import {
  githubUserSearchReducer,
  initialState as userSearchInitialState,
  setGithubUserSearchLoading,
  setGithubUserSearchResults,
  type GithubUserSearchState,
} from '$store/renderer/slices/github-user-search/github-user-search-slice';

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('svelte-sonner', () => ({ toast: toastMocks }));

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

import ShareWorkspaceDialog from '../ShareWorkspaceDialog.svelte';
import { warmImport } from '../../../../test/warm-import';

warmImport(() => import('../ShareWorkspaceDialog.svelte'));

const owner: WorkspaceMember = {
  principalId: 'p-alice',
  login: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  role: 'owner',
  addedAt: '2026-09-01T00:00:00Z',
};

const collaborator: WorkspaceMember = {
  principalId: 'p-bob',
  login: 'bob',
  displayName: null,
  avatarUrl: 'https://avatars.githubusercontent.com/u/2',
  role: 'collaborator',
  addedAt: '2026-09-02T00:00:00Z',
};

const openInvite: WorkspaceInvite = {
  id: 'inv-1',
  workspaceId: 'ws-1',
  createdByPrincipalId: 'p-alice',
  pinLogin: 'carol',
  pinGithubUserId: 3,
  url: 'intent://invite?v=1&h=example.test&p=5181&f=fp&t=tok-inv-1',
  createdAt: '2026-09-14T00:00:00Z',
  expiresAt: '2026-09-21T00:00:00Z',
};

const createdUrl = 'intent://invite?v=1&h=example.test&p=5181&f=fp&t=tok';
const createdLink = { inviteId: 'inv-2', url: createdUrl, pinLogin: 'dave' };

const baseProps = {
  open: true,
  workspaceId: 'ws-1',
  workspaceTitle: 'My Space',
  githubConnected: true,
  canManage: true,
  members: [owner, collaborator],
  invites: [openInvite],
};

function renderDialog(props: Record<string, unknown> = {}) {
  return render(ShareWorkspaceDialog, { props: { ...baseProps, ...props } });
}

beforeEach(() => {
  toastMocks.success.mockReset();
  toastMocks.error.mockReset();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => vi.clearAllMocks());

describe('ShareWorkspaceDialog — owner gate', () => {
  // Regression (fe#2440 review P1): a collaborator connection (or a -32003
  // refusal) sees the owner-only notice — no rows, no controls, no link.
  it('renders only the owner-only notice when the caller cannot manage sharing', () => {
    const onCreateInvite = vi.fn();
    renderDialog({
      canManage: false,
      onCreateInvite,
      createdLink,
      members: [owner, collaborator],
      invites: [openInvite],
    });

    expect(screen.getByTestId('share-owner-only')).toBeTruthy();
    expect(screen.queryByTestId('share-github-required')).toBeNull();
    expect(screen.queryByTestId('share-member-row')).toBeNull();
    expect(screen.queryByTestId('share-invite-row')).toBeNull();
    expect(screen.queryByTestId('share-created-link')).toBeNull();
    expect(screen.queryByLabelText(/Restrict to a GitHub user/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Revoke/ })).toBeNull();
    expect(screen.getByTestId('share-workspace-dialog').textContent).not.toContain('intent://');
    expect(onCreateInvite).not.toHaveBeenCalled();
  });
});

describe('ShareWorkspaceDialog — GitHub gate', () => {
  it('shows the connect-first state instead of the sharing controls when GitHub is not connected', async () => {
    const onConnectGitHub = vi.fn();
    renderDialog({ githubConnected: false, onConnectGitHub });

    expect(screen.getByTestId('share-github-required')).toBeTruthy();
    expect(screen.queryByLabelText(/Restrict to a GitHub user/)).toBeNull();
    expect(screen.queryByTestId('share-member-row')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(onConnectGitHub).toHaveBeenCalledTimes(1);
  });
});

describe('ShareWorkspaceDialog — roster and invites', () => {
  it('renders the roster and open invites from the slice state', () => {
    renderDialog();

    const rows = screen.getAllByTestId('share-member-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute('data-principal-id')).toBe('p-alice');
    expect(rows[1]!.getAttribute('data-principal-id')).toBe('p-bob');
    // The owner row has no Remove action (the daemon rejects removing the owner).
    expect(screen.queryByRole('button', { name: 'Remove Alice' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove bob' })).toBeTruthy();

    const invite = screen.getByTestId('share-invite-row');
    expect(invite.getAttribute('data-invite-id')).toBe('inv-1');
    expect(invite.textContent).toContain('@carol');
  });

  it('shows the loading row while the first read is in flight and the load error afterwards', async () => {
    const { rerender } = renderDialog({ members: [], invites: [], loading: true });
    expect(screen.getByTestId('share-members-loading')).toBeTruthy();

    await rerender({
      ...baseProps,
      members: [],
      invites: [],
      loading: false,
      loadError: 'Could not load sharing details',
    });
    expect(screen.queryByTestId('share-members-loading')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Could not load sharing details');
  });
});

describe('ShareWorkspaceDialog — create and copy', () => {
  it('submits the trimmed pin login and clears the draft once a link arrives', async () => {
    const onCreateInvite = vi.fn();
    const { rerender } = renderDialog({ onCreateInvite });

    const pin = screen.getByLabelText(/Restrict to a GitHub user/) as HTMLInputElement;
    await fireEvent.input(pin, { target: { value: ' dave ' } });
    await fireEvent.click(screen.getByRole('button', { name: /Create invite link/ }));

    expect(onCreateInvite).toHaveBeenCalledWith('dave');
    expect(pin.value).toBe(' dave ');

    await rerender({ ...baseProps, createdLink, onCreateInvite });
    await waitFor(() => expect(screen.getByTestId('share-created-link')).toBeTruthy());
    expect(screen.getByTestId('share-created-link-url').textContent).toBe(createdUrl);
    expect(screen.getByTestId('share-created-link').textContent).toContain('@dave');
    expect((screen.getByLabelText(/Restrict to a GitHub user/) as HTMLInputElement).value).toBe('');
  });

  it('submits an empty pin for an open invite and labels the link for anyone', async () => {
    const onCreateInvite = vi.fn();
    renderDialog({
      onCreateInvite,
      createdLink: { ...createdLink, pinLogin: undefined },
    });

    await fireEvent.click(screen.getByRole('button', { name: /Create invite link/ }));

    expect(onCreateInvite).toHaveBeenCalledWith('');
    expect(screen.getByTestId('share-created-link').textContent).toContain('Anyone with the link');
  });

  it('hides the created link block once the store has retired the link', () => {
    renderDialog({ createdLink: null });
    expect(screen.queryByTestId('share-created-link')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Copy link$/ })).toBeNull();
  });

  it('does not submit while a create is already in flight', async () => {
    const onCreateInvite = vi.fn();
    renderDialog({ onCreateInvite, creating: true });

    const submit = screen.getByRole('button', { name: /Creating/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.submit(submit.closest('form')!);
    expect(onCreateInvite).not.toHaveBeenCalled();
  });

  it('copies the created link to the clipboard and toasts', async () => {
    renderDialog({ createdLink });

    await fireEvent.click(screen.getByRole('button', { name: /^Copy link$/ }));

    await waitFor(() => expect(toastMocks.success).toHaveBeenCalledTimes(1));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(createdUrl);
  });

  it('copies an open invite row link again from the list', async () => {
    renderDialog({ invites: [openInvite, { ...openInvite, id: 'inv-3', pinLogin: undefined }] });

    await fireEvent.click(screen.getByRole('button', { name: /Copy invite link: Only @carol/ }));

    await waitFor(() => expect(toastMocks.success).toHaveBeenCalledTimes(1));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(openInvite.url);
    expect(screen.getAllByTestId('share-invite-copy')).toHaveLength(2);
  });

  it('toasts the failure when the clipboard write is rejected', async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('denied'),
    );
    renderDialog();

    await fireEvent.click(screen.getByRole('button', { name: /Copy invite link/ }));

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledTimes(1));
    expect(toastMocks.success).not.toHaveBeenCalled();
  });

  it('disables the row copy with the Remote Access hint when the daemon sent no url', async () => {
    renderDialog({ invites: [{ ...openInvite, url: undefined }] });

    const copy = screen.getByTestId('share-invite-copy') as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    expect(copy.getAttribute('title')).toMatch(/Remote Access/);
    await fireEvent.click(copy);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(toastMocks.success).not.toHaveBeenCalled();
  });

  it('surfaces the create error inline and keeps the field value', async () => {
    const { rerender } = renderDialog();
    const pin = screen.getByLabelText(/Restrict to a GitHub user/) as HTMLInputElement;
    await fireEvent.input(pin, { target: { value: 'nobody' } });

    await rerender({ ...baseProps, createError: 'No GitHub user named @nobody' });

    expect(screen.getByTestId('share-create-error').textContent).toContain('@nobody');
    expect(screen.queryByTestId('share-created-link')).toBeNull();
    expect((screen.getByLabelText(/Restrict to a GitHub user/) as HTMLInputElement).value).toBe(
      'nobody',
    );
  });
});

describe('ShareWorkspaceDialog — pin typeahead', () => {
  const octocat = {
    login: 'octocat',
    githubUserId: 1,
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    htmlUrl: 'https://github.com/octocat',
  };
  const octokit = { login: 'octokit', githubUserId: 2, avatarUrl: null, htmlUrl: null };

  const pinField = () => screen.getByRole('combobox') as HTMLInputElement;

  it('dispatches a normalized search per keystroke and skips it below two characters', async () => {
    const onSearchUsers = vi.fn();
    renderDialog({ onSearchUsers });
    onSearchUsers.mockClear();

    await fireEvent.input(pinField(), { target: { value: '@' } });
    await fireEvent.input(pinField(), { target: { value: '@oc' } });

    expect(onSearchUsers).toHaveBeenNthCalledWith(1, '');
    expect(onSearchUsers).toHaveBeenNthCalledWith(2, 'oc');
    expect(screen.queryByTestId('share-pin-suggestions')).toBeTruthy();
    expect(pinField().getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the list closed for a one-character query', async () => {
    renderDialog({ onSearchUsers: vi.fn() });
    await fireEvent.input(pinField(), { target: { value: 'o' } });
    expect(screen.queryByTestId('share-pin-suggestions')).toBeNull();
    expect(pinField().getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the rows for the current query with avatar or initial fallback', async () => {
    renderDialog({
      userSuggestions: [octocat, octokit],
      userSearchQuery: 'octo',
      onSearchUsers: vi.fn(),
    });
    await fireEvent.input(pinField(), { target: { value: 'octo' } });

    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.getAttribute('data-login'))).toEqual(['octocat', 'octokit']);
    expect(options[0]!.querySelector('img')!.getAttribute('src')).toBe(octocat.avatarUrl);
    expect(options[1]!.querySelector('img')).toBeNull();
    expect(screen.getByTestId('share-pin-avatar-fallback').textContent).toBe('O');
  });

  it('shows the searching row while the slice lags the input and hides stale rows', async () => {
    renderDialog({
      userSuggestions: [octocat],
      userSearchQuery: 'octo',
      onSearchUsers: vi.fn(),
    });
    await fireEvent.input(pinField(), { target: { value: 'octok' } });

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByTestId('share-pin-searching')).toBeTruthy();
  });

  // Regression (fe#2482 review F1): the props are derived from the real
  // reducer, as the host does, so the stale rows the slice used to keep across
  // `setLoading` would render here as current, selectable options.
  it('drops the previous query rows while the next query is pending, then shows only the new rows', async () => {
    const hubber = { login: 'hubber', githubUserId: 3, avatarUrl: null, htmlUrl: null };
    const propsFrom = (state: GithubUserSearchState) => ({
      ...baseProps,
      onSearchUsers: vi.fn(),
      userSuggestions: getItems(state.results),
      userSearchLoading: state.loading,
      userSearchError: state.error,
      userSearchQuery: state.lastQuery,
    });

    const octoSettled = githubUserSearchReducer(
      userSearchInitialState,
      setGithubUserSearchResults('octo', [octocat]),
    );
    const { rerender } = renderDialog(propsFrom(octoSettled));
    await fireEvent.input(pinField(), { target: { value: 'octo' } });
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('data-login'))).toEqual([
      'octocat',
    ]);

    await fireEvent.input(pinField(), { target: { value: 'hub' } });
    const hubPending = githubUserSearchReducer(octoSettled, setGithubUserSearchLoading('hub'));
    await rerender(propsFrom(hubPending));
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByTestId('share-pin-searching')).toBeTruthy();

    const hubSettled = githubUserSearchReducer(
      hubPending,
      setGithubUserSearchResults('hub', [hubber]),
    );
    await rerender(propsFrom(hubSettled));
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('data-login'))).toEqual([
      'hubber',
    ]);
    expect(screen.queryByTestId('share-pin-searching')).toBeNull();
  });

  it('shows the no-match row and the inline error for the current query', async () => {
    const { rerender } = renderDialog({
      userSuggestions: [],
      userSearchQuery: 'octo',
      onSearchUsers: vi.fn(),
    });
    await fireEvent.input(pinField(), { target: { value: 'octo' } });
    expect(screen.getByTestId('share-pin-no-results')).toBeTruthy();

    await rerender({
      ...baseProps,
      userSuggestions: [],
      userSearchQuery: 'octo',
      userSearchError: 'Could not search GitHub users',
    });
    expect(screen.getByTestId('share-pin-search-error').textContent).toContain(
      'Could not search GitHub users',
    );
    expect(screen.queryByTestId('share-pin-no-results')).toBeNull();
  });

  it('caps the list at eight rows', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...octokit,
      login: `user${i}`,
      githubUserId: i,
    }));
    renderDialog({ userSuggestions: many, userSearchQuery: 'user', onSearchUsers: vi.fn() });
    await fireEvent.input(pinField(), { target: { value: 'user' } });
    expect(screen.getAllByRole('option')).toHaveLength(8);
  });

  it('selects a row with the keyboard, pins the invite to it, and submits that login', async () => {
    const onSearchUsers = vi.fn();
    const onCreateInvite = vi.fn();
    renderDialog({
      userSuggestions: [octocat, octokit],
      userSearchQuery: 'octo',
      onSearchUsers,
      onCreateInvite,
    });
    const input = pinField();
    await fireEvent.input(input, { target: { value: 'octo' } });

    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1]!.id);
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true');

    await fireEvent.keyDown(input, { key: 'ArrowUp' });
    onSearchUsers.mockClear();
    await fireEvent.keyDown(input, { key: 'Enter' });

    const chip = screen.getByTestId('share-pin-selected');
    expect(chip.getAttribute('data-login')).toBe('octocat');
    expect(chip.querySelector('img')!.getAttribute('src')).toBe(octocat.avatarUrl);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByTestId('share-pin-suggestions')).toBeNull();
    expect(onSearchUsers).toHaveBeenCalledWith('');

    await fireEvent.click(screen.getByRole('button', { name: /Create invite link/ }));
    expect(onCreateInvite).toHaveBeenCalledWith('octocat');
  });

  it('selects a row by click and clears the chip back to an empty field', async () => {
    renderDialog({ userSuggestions: [octocat], userSearchQuery: 'octo', onSearchUsers: vi.fn() });
    await fireEvent.input(pinField(), { target: { value: 'octo' } });

    await fireEvent.click(screen.getByRole('option', { name: /@octocat/ }));
    expect(screen.getByTestId('share-pin-selected')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: /Clear selected GitHub user/ }));
    expect(screen.queryByTestId('share-pin-selected')).toBeNull();
    expect(pinField().value).toBe('');
  });

  it('closes the list on Escape without closing the dialog, and Enter submits free text', async () => {
    const onClose = vi.fn();
    const onCreateInvite = vi.fn();
    renderDialog({
      userSuggestions: [octocat],
      userSearchQuery: 'octo',
      onSearchUsers: vi.fn(),
      onClose,
      onCreateInvite,
    });
    const input = pinField();
    await fireEvent.input(input, { target: { value: 'octo' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);

    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('share-pin-suggestions')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    await fireEvent.submit(input.closest('form')!);
    expect(onCreateInvite).toHaveBeenCalledWith('octo');
  });

  it('clears the search when the dialog closes or retargets and after a link is minted', async () => {
    const onSearchUsers = vi.fn();
    const { rerender } = renderDialog({ onSearchUsers });
    await fireEvent.input(pinField(), { target: { value: 'octo' } });
    onSearchUsers.mockClear();

    await rerender({ ...baseProps, onSearchUsers, workspaceId: 'ws-2' });
    expect(onSearchUsers).toHaveBeenLastCalledWith('');
    expect(pinField().value).toBe('');

    await fireEvent.input(pinField(), { target: { value: 'octo' } });
    onSearchUsers.mockClear();
    await rerender({ ...baseProps, onSearchUsers, createdLink });
    expect(onSearchUsers).toHaveBeenLastCalledWith('');
    expect(pinField().value).toBe('');
  });

  it('never searches when GitHub is not connected', () => {
    const onSearchUsers = vi.fn();
    renderDialog({ githubConnected: false, onSearchUsers });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(onSearchUsers.mock.calls.filter(([q]) => q !== '')).toHaveLength(0);
  });
});

describe('ShareWorkspaceDialog — revoke and remove', () => {
  it('requests a revoke for the clicked invite', async () => {
    const onRevokeInvite = vi.fn();
    renderDialog({ onRevokeInvite });

    await fireEvent.click(screen.getByRole('button', { name: /Revoke invite/ }));

    expect(onRevokeInvite).toHaveBeenCalledWith('inv-1');
  });

  it('requests a removal only after the inline confirmation, and cancel backs out', async () => {
    const onRemoveMember = vi.fn();
    renderDialog({ onRemoveMember });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove bob' }));
    expect(onRemoveMember).not.toHaveBeenCalled();
    const confirm = screen.getByTestId('share-remove-confirm');
    expect(confirm.getAttribute('aria-label')).toContain('bob');

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('share-remove-confirm')).toBeNull();
    expect(onRemoveMember).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Remove bob' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm removing bob' }));
    expect(onRemoveMember).toHaveBeenCalledWith('p-bob');
    expect(screen.queryByTestId('share-remove-confirm')).toBeNull();
  });

  it('disables every revoke/remove control while one mutation is in flight', async () => {
    const onRevokeInvite = vi.fn();
    const onRemoveMember = vi.fn();
    renderDialog({ onRevokeInvite, onRemoveMember, removingPrincipalId: 'p-bob' });

    const revoke = screen.getByRole('button', { name: /Revoke invite/ }) as HTMLButtonElement;
    const remove = screen.getByRole('button', { name: 'Remove bob' }) as HTMLButtonElement;
    expect(revoke.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
  });

  it('shows the action error and keeps the roster', () => {
    renderDialog({ actionError: 'forbidden' });

    expect(screen.getByTestId('share-action-error').textContent).toContain('forbidden');
    expect(screen.getAllByTestId('share-member-row')).toHaveLength(2);
  });
});

describe('ShareWorkspaceDialog — dismissal', () => {
  it('closes on Escape and on the close button', async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    await fireEvent.keyDown(screen.getByTestId('share-workspace-dialog'), { key: 'Escape' });
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
