/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RpcCallProposal } from '$shared/types/proposal';
import type { RpcProposalResolution } from '$shared/types/rpc-proposal';
import RpcCallProposalCard from './RpcCallProposalCard.svelte';

const longNote = 'x'.repeat(5000);

function makeProposal(calls: RpcCallProposal['payload']['calls']): RpcCallProposal {
  return {
    kind: 'rpc-call',
    applyToolCallId: 'rpc-1',
    preview: { title: 'Archive stale workspaces', summary: 'On Studio, in order.' },
    payload: { operation: 'rpc.call', proposalId: 'rpc-1', calls },
  };
}

const call = (index: number, backend: string, method: string, params: unknown) => ({
  index,
  backend: { id: backend, name: backend === 'local' ? 'Studio' : 'Home server' },
  method,
  summary: 'Archives a workspace.',
  params,
});

afterEach(cleanup);

describe('RpcCallProposalCard', () => {
  it('shows every call with its full params, untruncated', () => {
    render(RpcCallProposalCard, {
      proposal: makeProposal([call(0, 'local', 'note.setContent', { content: longNote })]),
      onResolve: vi.fn(),
    });
    expect(screen.getByText('note.setContent')).toBeTruthy();
    const params = document.querySelector('[data-rpc-params]')!;
    expect(params.textContent).toContain(longNote);
  });

  it('groups calls by backend and names each backend only when there are several', () => {
    render(RpcCallProposalCard, {
      proposal: makeProposal([
        call(0, 'local', 'workspace.archive', { workspaceId: 'a' }),
        call(1, 'fp:AB', 'workspace.archive', { workspaceId: 'b' }),
      ]),
      onResolve: vi.fn(),
    });
    const groups = [...document.querySelectorAll('[data-rpc-backend]')];
    expect(groups.map((g) => g.getAttribute('data-rpc-backend'))).toEqual(['local', 'fp:AB']);
    expect(screen.getByText('Studio')).toBeTruthy();
    expect(screen.getByText('Home server')).toBeTruthy();
  });

  it('sends the decision once and shows a failure inline', async () => {
    let finish: (value: RpcProposalResolution) => void = () => {};
    const onResolve = vi.fn(
      () => new Promise<RpcProposalResolution>((resolve) => (finish = resolve)),
    );
    render(RpcCallProposalCard, {
      proposal: makeProposal([call(0, 'local', 'workspace.archive', { workspaceId: 'a' })]),
      onResolve,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Running…' }));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith('approve');
    finish({ success: false, error: 'Conflict' });
    expect(await screen.findByText('Could not finish: Conflict')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onResolve).toHaveBeenLastCalledWith('reject');
  });
});
