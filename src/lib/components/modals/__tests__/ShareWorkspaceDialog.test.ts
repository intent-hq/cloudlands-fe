/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceInvite, WorkspaceMember } from '$features/workspace-sharing/types';

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
  createdAt: '2026-09-14T00:00:00Z',
  expiresAt: '2026-09-21T00:00:00Z',
};

const createdUrl = 'intent://invite?v=1&h=example.test&p=5181&f=fp&t=tok';
const createdLink = { inviteId: 'inv-2', linkHandle: 'invite-link-1', pinLogin: 'dave' };

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
      createdLinkUrl: createdUrl,
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

    await rerender({ ...baseProps, createdLink, createdLinkUrl: createdUrl, onCreateInvite });
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
      createdLinkUrl: createdUrl,
    });

    await fireEvent.click(screen.getByRole('button', { name: /Create invite link/ }));

    expect(onCreateInvite).toHaveBeenCalledWith('');
    expect(screen.getByTestId('share-created-link').textContent).toContain('Anyone with the link');
  });

  // Regression (fe#2440 review P2): once the link's vault entry is gone (revoked,
  // dialog reopened) the copy affordance disappears with it.
  it('hides the created link block when the url can no longer be resolved', () => {
    renderDialog({ createdLink, createdLinkUrl: null });
    expect(screen.queryByTestId('share-created-link')).toBeNull();
    expect(screen.queryByRole('button', { name: /Copy link/ })).toBeNull();
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
    renderDialog({ createdLink, createdLinkUrl: createdUrl });

    await fireEvent.click(screen.getByRole('button', { name: /Copy link/ }));

    await waitFor(() => expect(toastMocks.success).toHaveBeenCalledTimes(1));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(createdUrl);
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
