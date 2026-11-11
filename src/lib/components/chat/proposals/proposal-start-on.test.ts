import { describe, expect, it } from 'vitest';
import type { WorkspaceCreateProposal } from '$shared/types/proposal';
import type { StartOnOption } from '$features/remote-machines/start-on';
import { proposalStartOnChoices, proposalStartOnDefault } from './proposal-start-on';

function proposal(placement?: unknown): WorkspaceCreateProposal {
  return {
    kind: 'workspace-create',
    payload: { operation: 'workspace.create', params: {} },
    preview: { title: 'Follow up', workspaceCreate: { mode: 'sibling' } },
    ...(placement === undefined ? {} : { placement }),
  } as WorkspaceCreateProposal;
}

const remoteAgent = {
  nodeId: 'd-lab',
  nodeName: 'Lab PC',
  placement: { target: 'remote', checkout: 'isolated', nodeId: 'd-lab' },
} as const;
const e2bAgent = {
  nodeId: 'sbx-1',
  placement: { target: 'e2b', checkout: 'isolated', cloudMachineId: 'e2b-team' },
} as const;

describe('proposalStartOnDefault', () => {
  it('maps the stamped placement to a Start on id', () => {
    expect(proposalStartOnDefault(proposal({ target: 'local' }), remoteAgent)).toBe('');
    expect(
      proposalStartOnDefault(proposal({ target: 'remote', nodeId: 'd-mac' }), remoteAgent),
    ).toBe('d-mac');
    expect(
      proposalStartOnDefault(proposal({ target: 'e2b', cloudMachineId: 'e2b-team' }), null),
    ).toBe('cloud:e2b-team');
  });

  it('names the original E2B entry when the placement names none', () => {
    expect(proposalStartOnDefault(proposal({ target: 'e2b' }), null)).toBe('cloud:e2b');
  });

  it('falls back to where the proposer runs when no placement is stamped', () => {
    expect(proposalStartOnDefault(proposal(), remoteAgent)).toBe('d-lab');
    expect(proposalStartOnDefault(proposal(), e2bAgent)).toBe('cloud:e2b-team');
    expect(proposalStartOnDefault(proposal(), { placement: undefined })).toBe('');
    expect(proposalStartOnDefault(proposal(), null)).toBe('');
  });

  it('ignores a malformed placement and uses the fallback', () => {
    expect(proposalStartOnDefault(proposal({ target: 'mars' }), remoteAgent)).toBe('d-lab');
    expect(proposalStartOnDefault(proposal({ target: 'remote' }), remoteAgent)).toBe('d-lab');
    expect(proposalStartOnDefault(proposal('local'), null)).toBe('');
  });
});

describe('proposalStartOnChoices', () => {
  const backend: StartOnOption = { id: '', label: 'intent1', platform: null, disabled: false };
  const mac: StartOnOption = { id: 'd-mac', label: 'Mac mini', platform: null, disabled: false };
  const lab: StartOnOption = {
    id: 'd-lab',
    label: 'Lab PC',
    platform: null,
    disabled: true,
    reason: 'Unreachable',
  };

  it('reports a usable choice as available', () => {
    const choices = proposalStartOnChoices([backend, mac], 'd-mac', 'Another machine');
    expect(choices.options).toEqual([backend, mac]);
    expect(choices.unavailable).toBeNull();
    expect(proposalStartOnChoices([backend], '', 'x').unavailable).toBeNull();
  });

  it('keeps a listed but unusable choice and reports it', () => {
    const choices = proposalStartOnChoices([backend, mac, lab], 'd-lab', 'Another machine');
    expect(choices.options).toEqual([backend, mac, lab]);
    expect(choices.unavailable).toEqual(lab);
  });

  it('adds a gone choice as a disabled row so the card can still show it', () => {
    const choices = proposalStartOnChoices([backend, mac], 'd-gone', 'Old box');
    expect(choices.options.map((option) => option.id)).toEqual(['', 'd-mac', 'd-gone']);
    expect(choices.unavailable).toMatchObject({ id: 'd-gone', label: 'Old box', disabled: true });
    expect(choices.unavailable?.reason).toBeTruthy();
  });

  it('marks a gone E2B entry as a cloud row', () => {
    const choices = proposalStartOnChoices([backend], 'cloud:e2b-old', 'E2B');
    expect(choices.unavailable).toMatchObject({ kind: 'cloud', disabled: true });
  });
});
