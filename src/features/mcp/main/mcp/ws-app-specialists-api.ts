import type { SpecialistEditProposal } from '$shared/types/proposal';
import {
  generateUniqueSpecialistId,
  type SpecialistFileScope,
} from '$shared/specialist-file-types';
import { Logger } from '$shared/logger';
import {
  getAllEffectiveSpecialists,
  getEffectiveSpecialist,
  refreshSpecialistsFromFiles,
  type EffectiveSpecialist,
} from '$features/agent/main/specialists.service';
import type { ToolCall } from './protocol';
import { emitProposalToChat, proposalToolResult } from './ws-app-proposal-content';

const logger = new Logger('WsAppSpecialistsApi');

type SpecialistProposalOperation = 'create' | 'edit' | 'delete';

type SpecialistProposalInput = {
  action?: SpecialistProposalOperation;
  operation?: SpecialistProposalOperation;
  create?: Partial<SpecialistProposalPayload>;
  edit?: Partial<SpecialistProposalPayload>;
  delete?: Partial<SpecialistProposalPayload>;
} & Partial<SpecialistProposalPayload>;

type SpecialistProposalPayload = {
  id: string;
  name: string;
  description: string;
  model: string;
  prompt: string;
  behaviorPrompt: string;
  codingAgent?: string;
  roleReminder?: string;
  scope?: SpecialistFileScope;
};

type SerializableSpecialist = {
  id: string;
  name: string;
  description: string;
  codingAgent: string;
  model: string;
  modelTier?: EffectiveSpecialist['modelTier'];
  prompt: string;
  behaviorPrompt: string;
  roleReminder?: string;
  isCustomized: boolean;
};

function serializeSpecialist(specialist: EffectiveSpecialist): SerializableSpecialist {
  return {
    id: specialist.id,
    name: specialist.name,
    description: specialist.description,
    codingAgent: specialist.codingAgent,
    model: specialist.model,
    modelTier: specialist.modelTier,
    prompt: specialist.behaviorPrompt,
    behaviorPrompt: specialist.behaviorPrompt,
    roleReminder: specialist.roleReminder,
    isCustomized: specialist.isCustomized,
  };
}

function getOperation(input: SpecialistProposalInput): SpecialistProposalOperation {
  const operation = input.action ?? input.operation;
  if (operation === 'create' || input.create) return 'create';
  if (operation === 'edit' || input.edit) return 'edit';
  if (operation === 'delete' || input.delete) return 'delete';
  throw new Error('propose() requires action/operation to be create, edit, or delete');
}

function getOperationPayload(
  input: SpecialistProposalInput,
  operation: SpecialistProposalOperation,
) {
  return {
    ...input,
    ...(input[operation] ?? {}),
  } as Partial<SpecialistProposalPayload>;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function buildDraft(
  operation: SpecialistProposalOperation,
  payload: Partial<SpecialistProposalPayload>,
  current: EffectiveSpecialist | null,
  existingIds: Iterable<string>,
): SpecialistProposalPayload {
  const name = nonEmptyString(payload.name) ?? current?.name ?? '';
  const prompt =
    typeof payload.prompt === 'string'
      ? payload.prompt
      : typeof payload.behaviorPrompt === 'string'
        ? payload.behaviorPrompt
        : (current?.behaviorPrompt ?? '');
  const id =
    nonEmptyString(payload.id) ??
    current?.id ??
    (operation === 'create'
      ? generateUniqueSpecialistId(name || 'specialist', existingIds)
      : undefined);

  if (!id) throw new Error('Specialist id is required');
  if (operation !== 'delete' && !name) throw new Error('Specialist name is required');
  if (operation !== 'delete' && !prompt.trim()) throw new Error('Specialist prompt is required');

  return {
    id,
    name,
    description: nonEmptyString(payload.description) ?? current?.description ?? 'Custom specialist',
    model: nonEmptyString(payload.model) ?? current?.model ?? '',
    prompt,
    behaviorPrompt: prompt,
    codingAgent: nonEmptyString(payload.codingAgent) ?? current?.codingAgent,
    roleReminder:
      typeof payload.roleReminder === 'string' ? payload.roleReminder : current?.roleReminder,
    scope: payload.scope,
  };
}

function field(
  key: string,
  label: string,
  draftValue: string,
  currentValue: string | undefined,
  editable: boolean,
  multiline = false,
) {
  return currentValue !== undefined
    ? { key, label, before: currentValue, after: draftValue, editable, multiline }
    : { key, label, value: draftValue, editable, multiline };
}

function buildProposal(
  operation: SpecialistProposalOperation,
  draft: SpecialistProposalPayload,
  current: EffectiveSpecialist | null,
): SpecialistEditProposal {
  const editable = operation !== 'delete';
  const titleVerb = operation === 'create' ? 'Create' : operation === 'edit' ? 'Edit' : 'Delete';
  const proposal: SpecialistEditProposal = {
    kind: 'specialist-edit',
    payload: {
      operation,
      ...draft,
      behaviorPrompt: draft.prompt,
    },
    preview: {
      title: `${titleVerb} specialist: ${draft.name || draft.id}`,
      summary:
        operation === 'delete'
          ? 'Deletes the file-based specialist or removes a user override for a built-in specialist.'
          : 'Review and edit the specialist fields before applying.',
      fields: [
        field('name', 'Name', draft.name, current?.name, editable),
        field(
          'description',
          'Description',
          draft.description,
          current?.description,
          editable,
          true,
        ),
        field('model', 'Model', draft.model, current?.model, editable),
        field('prompt', 'Prompt', draft.prompt, current?.behaviorPrompt, editable, true),
      ],
      warnings:
        operation === 'delete'
          ? [
              'Applying this proposal dispatches the same delete action used by the specialist editor.',
            ]
          : undefined,
    },
  };

  return proposal;
}

export function buildWsAppSpecialistsApi(
  workspacePath: string,
  workspaceId: string,
  call: ToolCall,
) {
  return {
    async list() {
      logger.debug('ws.app.specialists.list', { workspacePath });
      await refreshSpecialistsFromFiles(workspacePath);
      return getAllEffectiveSpecialists(undefined, workspacePath).map(serializeSpecialist);
    },

    async get(id: string) {
      logger.debug('ws.app.specialists.get', { workspacePath, id });
      if (!id) throw new Error('Specialist id is required');
      await refreshSpecialistsFromFiles(workspacePath);
      const specialist = getEffectiveSpecialist(id, undefined, workspacePath);
      if (!specialist) throw new Error(`Specialist not found: ${id}`);
      return serializeSpecialist(specialist);
    },

    async propose(input: SpecialistProposalInput) {
      logger.debug('ws.app.specialists.propose', {
        workspacePath,
        action: input?.action ?? input?.operation,
      });
      if (!input || typeof input !== 'object') {
        throw new Error('propose() requires a proposal object');
      }

      await refreshSpecialistsFromFiles(workspacePath);
      const operation = getOperation(input);
      const payload = getOperationPayload(input, operation);
      const current = payload.id
        ? getEffectiveSpecialist(payload.id, undefined, workspacePath)
        : null;

      if ((operation === 'edit' || operation === 'delete') && !current) {
        throw new Error(`Specialist not found: ${payload.id ?? '(missing id)'}`);
      }

      const existingIds = getAllEffectiveSpecialists(undefined, workspacePath).map(
        (specialist) => specialist.id,
      );
      const draft = buildDraft(operation, payload, current, existingIds);
      const proposal = buildProposal(operation, draft, current);

      const emitResult = emitProposalToChat(workspaceId, call.context?.agentId, proposal);
      if (!emitResult.ok) {
        throw new Error(`Failed to emit proposal to chat: ${emitResult.error}`);
      }
      return proposalToolResult(proposal);
    },
  };
}
