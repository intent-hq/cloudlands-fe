import type { ProposalActionDetail, SpecialistEditProposal } from '$shared/types/proposal';
import { selectParsedCompoundModelId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { m } from '$shared/paraglide/messages.js';
import {
  generateUniqueSpecialistId,
  type SpecialistFileScope,
} from '$shared/specialist-file-types';
import { store as appStore } from "$store/renderer/store";
import type { StoreState } from '$store/renderer/types';
import { selectSelectedModel } from '$store/renderer/slices/model/model-selectors';
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
  selectGetFileSpecialist,
  selectSpecialists,
} from '$store/renderer/slices/specialists/specialists-selectors';
import {
  deleteFileSpecialist as deleteFileSpecialistAction,
  saveFileSpecialist,
  type FileSpecialist,
} from '$store/renderer/slices/specialists/specialists-slice';
import { selectActiveWorkspace } from '$store/renderer/slices/workspace/workspace-selectors';
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

function getCurrentWorkspacePath(state: StoreState): string | undefined {
  const workspace = selectActiveWorkspace.select(state);
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
): FileSpecialistWritePayload {
  return {
    id,
    name: current.name,
    description: current.description,
    codingAgent:
      fileSpec?.codingAgent ?? current.codingAgent ?? selectEffectiveCodingAgent.select(state, id),
    // Explicit frontmatter model only — the daemon's resolvedModel preview
    // must never be baked into the file (it would pin a floating default).
    model: fileSpec?.model || current.defaultModel,
    roleReminder: fileSpec?.roleReminder ?? current.roleReminder,
    behaviorPrompt: fileSpec?.behaviorPrompt ?? selectEffectiveBehaviorPrompt.select(state, id),
    scope,
    workspacePath,
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
  const workspacePath = scope === 'project' ? getCurrentWorkspacePath(state) : undefined;
  const reverse: SpecialistReverseAction =
    operation === 'create'
      ? { kind: 'delete', id, scope, workspacePath }
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
            ),
          }
        : { kind: 'delete', id, scope, workspacePath };

  if (operation === 'delete') {
    appStore.dispatch(deleteFileSpecialistAction({ id, scope, workspacePath }));
    return { reverse };
  }

  // Fallback when the proposal carries no model: the explicit frontmatter
  // model only (empty ⇒ the file stays model-less and the daemon resolves the
  // default) — never the daemon's resolvedModel preview, which would bake a
  // floating default into the file as a pin.
  const fallbackModel = current
    ? (current.defaultModel ?? '')
    : selectSelectedModel.select(state);
  const model = stringField(proposal, detail, 'model', fallbackModel).trim();
  const { providerId } = selectParsedCompoundModelId.select(state, model);
  const description = stringField(
    proposal,
    detail,
    'description',
    current?.description ?? m.chat_specialistProposalActions_customSpecialist_fallback(),
  ).trim();
  const prompt = stringField(
    proposal,
    detail,
    'prompt',
    current ? selectEffectiveBehaviorPrompt.select(state, current.id) : '',
  );
  appStore.dispatch(
    saveFileSpecialist({
      id,
      name,
      description: description || m.chat_specialistProposalActions_customSpecialist_fallback(),
      codingAgent:
        payload.codingAgent ??
        (current ? selectEffectiveCodingAgent.select(state, current.id) : providerId),
      model,
      roleReminder: payload.roleReminder ?? current?.roleReminder,
      behaviorPrompt: prompt,
      scope,
      workspacePath,
    }),
  );
  if (operation === 'create') await navigateToCreatedSpecialist(id);

  return { reverse };
}

export async function undoSpecialistProposalWork(
  reverse: SpecialistReverseAction,
): Promise<void> {
  if (reverse.kind === 'delete') {
    const { id, scope, workspacePath } = reverse;
    appStore.dispatch(deleteFileSpecialistAction({ id, scope, workspacePath }));
    return;
  }

  appStore.dispatch(saveFileSpecialist(reverse.specialist));
}

export function undoSpecialistProposal(proposalId: string): boolean {
  const store = appStore;
  const appliedState = selectSpecialistProposalAppliedState.select(appStore.state, proposalId);
  if (!appliedState) return false;
  store.dispatch(undoProposalRequested({ proposalId, kind: 'specialist-edit' }));
  return true;
}
