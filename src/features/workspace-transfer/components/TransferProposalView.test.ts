/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTransferProposal } from '$shared/types/proposal';
import { warmImport } from '../../../test/warm-import';

warmImport(() => import('./TransferProposalView.svelte'));
const proposal: WorkspaceTransferProposal = {
  kind: 'workspace-transfer',
  applyToolCallId: 'p',
  payload: { operation: 'workspace.transfer', workspaceId: 'w', sourceWorkspacePath: '/repo/w' },
  preview: { title: 'Transfer project', warnings: ['Running agents will stop.'] },
};
const props = { proposal, source: 'Source', destinations: [{ value: 'target', label: 'Laptop' }] };

describe('inline transfer approval', () => {
  it('requires an explicit destination and cancel never approves', async () => {
    const { default: View } = await import('./TransferProposalView.svelte');
    const onapprove = vi.fn();
    const oncancel = vi.fn();
    render(View, { ...props, onapprove, oncancel });
    expect(screen.getByRole('button', { name: 'Approve transfer' }).hasAttribute('disabled')).toBe(
      true,
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(oncancel).toHaveBeenCalledOnce();
    expect(onapprove).not.toHaveBeenCalled();
  });
  it('discloses effects and only approves after the user clicks', async () => {
    const { default: View } = await import('./TransferProposalView.svelte');
    const onapprove = vi.fn();
    render(View, { ...props, destinationId: 'target', onapprove });
    expect(screen.getByText(/source project is archived/)).toBeTruthy();
    expect(screen.getByText('Running agents will stop.')).toBeTruthy();
    expect(onapprove).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Approve transfer' }));
    expect(onapprove).toHaveBeenCalledOnce();
  });
  it('locks the destination and cancellation after import but allows finishing', async () => {
    const { default: View } = await import('./TransferProposalView.svelte');
    render(View, {
      ...props,
      destinationId: 'target',
      entry: {
        status: 'failed',
        error: 'offline',
        result: {
          transfer: {
            workspaceId: 'w',
            sourceWorkspacePath: '/repo/w',
            sourceConnectionId: 'source',
            destinationConnectionId: 'target',
            phase: 'imported',
          },
        },
      },
    });
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Finish transfer' }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(screen.getByText(/will not import it again/)).toBeTruthy();
  });
  it('explains the desktop requirement and blocks browser approval', async () => {
    const { default: View } = await import('./TransferProposalView.svelte');
    render(View, { ...props, destinationId: 'target', desktop: false });
    expect(screen.getByRole('alert').textContent).toContain('desktop app');
    expect(screen.getByRole('button', { name: 'Approve transfer' }).hasAttribute('disabled')).toBe(
      true,
    );
  });
});
