import type { ProposalActionDetail } from '$shared/types/proposal';


import { store as appStore } from '$store/renderer/store';


import {
  applyProposalRequested,
} from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice';




import { getProposalId } from './proposal-id';

export function applySpecialistProposal(detail: ProposalActionDetail): boolean {
  const { proposal } = detail;
  if (proposal.kind !== 'specialist-edit') return false;

  const proposalId = getProposalId(proposal);
  appStore.dispatch(applyProposalRequested({ proposalId, kind: 'specialist-edit', detail }));
  return true;
}
