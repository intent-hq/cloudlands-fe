/**
 * Regression (cloudlands-fe v2.371.0): a workspace proposal stamped by an
 * agent on the host ("Start on <host>") must create on a backend with the
 * remote initial agent subset and no agentNodes. The card's choice flows
 * through the same helpers it uses into the renderer placement policy.
 */
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceCreateProposal } from '$shared/types/proposal';
import {
  initialAgentPlacement,
  START_ON_HOST,
  startOnSubmitted,
} from '$features/remote-machines/start-on';
import { proposalStartOnDefault } from '$lib/components/chat/proposals/proposal-start-on';
import { buildCreateWorkspaceRequestFromProposal } from '$store/renderer/slices/workspace-operations/utils/workspace-create-proposal';
import { prepareNodeRequest } from './node-placement-policy';

const proposal: WorkspaceCreateProposal = {
  kind: 'workspace-create',
  payload: { operation: 'workspace.create', params: { title: 'Fix the docs' } },
  preview: { title: 'Fix the docs' },
  placement: { target: 'local' },
};

function backend(capabilities: Record<string, unknown>) {
  return vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'client.hello') return { server: { capabilities } };
    throw new Error(`Unexpected ${method}`);
  });
}

describe('a proposal stamped on the host', () => {
  it('creates on a backend with remoteMachines and remoteInitialAgent, without agentNodes', async () => {
    const value = proposalStartOnDefault(proposal, null);
    expect(value).toBe(START_ON_HOST);
    const placement = initialAgentPlacement(startOnSubmitted(value, value)) ?? null;
    expect(placement).toEqual({ target: 'local' });
    const request = buildCreateWorkspaceRequestFromProposal(
      proposal,
      { placement },
      { resolveAgentName: () => 'Agent' },
    );
    const transport = backend({ remoteMachines: 1, remoteInitialAgent: 1 });
    await expect(
      prepareNodeRequest(
        'workspace.create',
        request,
        transport,
        () => true,
        () => transport('client.hello'),
      ),
    ).resolves.toEqual(request);
  });
});
