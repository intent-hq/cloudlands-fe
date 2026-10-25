/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import RetireWorkspaceConfirmDialog from '../RetireWorkspaceConfirmDialog.svelte';

function mount() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(RetireWorkspaceConfirmDialog, {
    open: true,
    workspaceTitle: 'Old experiment',
    onConfirm,
    onCancel,
  });
  return { onConfirm, onCancel };
}

describe('RetireWorkspaceConfirmDialog', () => {
  it('names the workspace and explains that the folder on disk is deleted', async () => {
    mount();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(
      m.workspace_retire_confirm_title({ title: 'Old experiment' }),
    );
    expect(dialog.textContent).toContain(m.workspace_retire_confirm_description());
  });

  it('confirms through the retire action', async () => {
    const { onConfirm, onCancel } = mount();
    await fireEvent.click(
      await screen.findByRole('button', { name: m.workspace_retire_confirm_action() }),
    );
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels without retiring', async () => {
    const { onConfirm, onCancel } = mount();
    await fireEvent.click(await screen.findByRole('button', { name: 'Cancel', exact: true }));
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
