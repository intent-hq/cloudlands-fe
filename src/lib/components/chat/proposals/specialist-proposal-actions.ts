import type { ProposalActionDetail, SpecialistEditProposal } from '$shared/types/proposal';
import { m } from '$shared/paraglide/messages.js';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import {
  generateUniqueSpecialistId,
  type SpecialistFileScope,
} from '$shared/specialist-file-types';
import { store as appStore } from '$store/renderer/store';
import type { StoreState } from '$store/renderer/types';
import { selectSelectedModel } from '$store/renderer/slices/model/model-selectors';
import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { selectSpecialistProposalAppliedState } from '$store/renderer/slices/specialist-proposal-history/specialist-proposal-history-selectors';
import type {
  FileSpecialistWritePayload,
  SpecialistReverseAction,
} from '$store/renderer/slices/specialist-proposal-history/specialist-proposal-history-types';
import {
  applyProposalRequested,
  undoProposalRequested,
} from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice';
import {
  selectEffectiveBehaviorPrompt,
  selectEffectiveCodingAgent,
  selectEffectiveModel,
  selectGetFileSpecialist,
  selectSpecialists,
} from '$store/renderer/slices/specialists/specialists-selectors';
import {
  deleteFileSpecialist as deleteFileSpecialistAction,
  saveFileSpecialist,
  type FileSpecialist,
} from '$store/renderer/slices/specialists/specialists-slice';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import { getProposalId } from './proposal-id';

type SpecialistProposalOperation = 'create' | 'edit' | 'delete';

type SpecialistProposalPayload = {
  operation?: SpecialistProposalOperation;
  action?: SpecialistProposalOperation;
  id?: string;
  name?: string;
  description?: string;
  model?: string;
  prompt?: string;
  behaviorPrompt?: string;
  codingAgent?: string;
  roleReminder?: string;
  scope?: SpecialistFileScope;
};

function getPayload(proposal: SpecialistEditProposal): SpecialistProposalPayload {
  return proposal.payload;
}

function stringField(
  proposal: SpecialistEditProposal,
  detail: ProposalActionDetail,
  key: keyof SpecialistProposalPayload,
  fallback = '',
): string {
  const edited = detail.editedFields[key];
  if (edited !== undefined) return typeof edited === 'string' ? edited : String(edited ?? '');
  const value = getPayload(proposal)[key];
  return typeof value === 'string' ? value : fallback;
}

function getCurrentWorkspacePath(state: StoreState, workspaceId?: string): string | undefined {
  if (!workspaceId) return undefined;
  const workspace = selectWorkspaceById.select(state, workspaceId);
  return workspace?.path ?? workspace?.worktreePath ?? workspace?.repositoryPath;
}

function getScope(scope: unknown, fallback?: SpecialistFileScope): SpecialistFileScope {
  return scope === 'project' || scope === 'user' ? scope : (fallback ?? 'user');
}

function buildCurrentSpecialistPayload(
  state: StoreState,
  id: string,
  current: ReturnType<typeof selectSpecialists.select>[number],
  fileSpec: FileSpecialist | undefined,
  scope: SpecialistFileScope,
  workspacePath: string | undefined,
  workspaceId?: string,
): FileSpecialistWritePayload {
  return {
    id,
    name: current.name,
    description: current.description,
    codingAgent:
      fileSpec?.codingAgent ?? current.codingAgent ?? selectEffectiveCodingAgent.select(state, id),
    model: fileSpec?.model ?? current.defaultModel ?? selectEffectiveModel.select(state, id),
    roleReminder: fileSpec?.roleReminder ?? current.roleReminder,
    behaviorPrompt: fileSpec?.behaviorPrompt ?? selectEffectiveBehaviorPrompt.select(state, id),
    scope,
    workspacePath,
    workspaceId,
  };
}

async function navigateToCreatedSpecialist(id: string): Promise<void> {
  const { navigateToSettings } = await import('$lib/utils/workspace-navigation');
  await navigateToSettings({ tab: 'agents', specialist: id });
}

export function applySpecialistProposal(detail: ProposalActionDetail): boolean {
  const { proposal } = detail;
  if (proposal.kind !== 'specialist-edit') return false;

  const proposalId = getProposalId(proposal);
  appStore.dispatch(applyProposalRequested({ proposalId, kind: 'specialist-edit', detail }));
  return true;
}

export async function applySpecialistProposalWork(
  detail: ProposalActionDetail,
): Promise<{ reverse: SpecialistReverseAction }> {
  const { proposal } = detail;
  if (proposal.kind !== 'specialist-edit') {
    throw new Error('applySpecialistProposalWork requires a specialist-edit proposal');
  }

  const state = appStore.state;
  const payload = getPayload(proposal);
  const operation = payload.operation ?? payload.action ?? 'edit';
  const existingSpecialists = selectSpecialists.select(state);
  const requestedId = typeof payload.id === 'string' ? payload.id : '';
  const current = requestedId
    ? existingSpecialists.find((specialist) => specialist.id === requestedId)
    : undefined;
  const name = stringField(proposal, detail, 'name', current?.name ?? '').trim();
  const id =
    requestedId ||
    generateUniqueSpecialistId(
      name || 'specialist',
      existingSpecialists.map((specialist) => specialist.id),
    );
  const fileSpec = selectGetFileSpecialist.select(state, id);
  const scope = getScope(payload.scope, fileSpec?.source);
  const workspaceId = scope === 'project' ? detail.workspaceId : undefined;
  const workspacePath =
    scope === 'project' ? getCurrentWorkspacePath(state, workspaceId) : undefined;
  const reverse: SpecialistReverseAction =
    operation === 'create'
      ? { kind: 'delete', id, scope, workspacePath, workspaceId }
      : current
        ? {
            kind: 'save',
            specialist: buildCurrentSpecialistPayload(
              state,
              id,
              current,
              fileSpec,
              scope,
              workspacePath,
              workspaceId,
            ),
          }
        : { kind: 'delete', id, scope, workspacePath, workspaceId };

  if (operation === 'delete') {
    await appStore.dispatch(deleteFileSpecialistAction({ id, scope, workspacePath, workspaceId }));
    return { reverse };
  }

  const fallbackModel = current
    ? selectEffectiveModel.select(state, current.id)
    : selectSelectedModel.select(state);
  // Writes emit bare model ids only (PROTOCOL §5.11): a legacy compound
  // proposal/fallback model splits into the bare id plus its provider, the
  // prefix winning as the codingAgent (`|| fallback` so a malformed empty
  // prefix never propagates as a "real" provider id).
  const rawModel = stringField(proposal, detail, 'model', fallbackModel).trim();
  const { providerId: modelProviderId, modelId: model } = splitLegacyCompoundId(rawModel);
  const defaultProviderId = selectEffectiveDefaultProviderId.select(state);
  const providerId = modelProviderId || defaultProviderId;
  const description = stringField(
    proposal,
    detail,
    'description',
    current?.description ?? m.settings_aiBehavior_customSpecialistFallback(),
  ).trim();
  const prompt = stringField(
    proposal,
    detail,
    'prompt',
    current ? selectEffectiveBehaviorPrompt.select(state, current.id) : '',
  );

  const saveAction = saveFileSpecialist({
    id,
    name,
    description: description || m.settings_aiBehavior_customSpecialistFallback(),
    // A compound model's provider prefix outranks the payload/effective
    // codingAgent, mirroring the daemon's split-on-read precedence.
    codingAgent:
      modelProviderId ||
      (payload.codingAgent ??
        (current ? selectEffectiveCodingAgent.select(state, current.id) : providerId)),
    model,
    roleReminder: payload.roleReminder ?? current?.roleReminder,
    behaviorPrompt: prompt,
    scope,
    workspacePath,
    workspaceId,
  });
  await appStore.dispatch(saveAction);
  if (operation === 'create') await navigateToCreatedSpecialist(id);

  return { reverse };
}

export async function undoSpecialistProposalWork(reverse: SpecialistReverseAction): Promise<void> {
  if (reverse.kind === 'delete') {
    const { id, scope, workspacePath, workspaceId } = reverse;
    await appStore.dispatch(deleteFileSpecialistAction({ id, scope, workspacePath, workspaceId }));
    return;
  }

  await appStore.dispatch(saveFileSpecialist(reverse.specialist));
}

export function undoSpecialistProposal(proposalId: string): boolean {
  const appliedState = selectSpecialistProposalAppliedState.select(appStore.state, proposalId);
  if (!appliedState) return false;
  appStore.dispatch(undoProposalRequested({ proposalId, kind: 'specialist-edit' }));
  return true;
}
