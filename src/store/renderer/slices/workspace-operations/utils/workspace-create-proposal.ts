import type { CreateWorkspaceRequest } from '$shared/types';
import { createAgentTypeId } from '$shared/types/agent.types';
import type { WorkspaceCreateProposal } from '$shared/types/proposal';

type InitialAgentRequest = NonNullable<CreateWorkspaceRequest['initialAgent']>;

function stringOverride(value: unknown, fallback?: string): string | undefined {
  return typeof value === 'string' ? value : fallback;
}

function booleanOverride(value: unknown, fallback?: boolean): boolean | undefined {
  return typeof value === 'boolean' ? value : fallback;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function specialistOverride(value: unknown, fallback?: string): string | undefined {
  if (typeof value === 'string') return value;
  if (value === null) return undefined;
  return fallback;
}

function withoutSpecialist(metadata: Record<string, unknown>): Record<string, unknown> {
  const next = { ...metadata };
  delete next.specialist;
  return next;
}

export function buildCreateWorkspaceRequestFromProposal(
  proposal: WorkspaceCreateProposal,
  editedFields: Record<string, unknown> | undefined,
): CreateWorkspaceRequest {
  const params = (proposal.payload.params ?? {}) as Partial<CreateWorkspaceRequest>;
  const initialAgent = recordValue(params.initialAgent) as Partial<InitialAgentRequest> | undefined;
  const specialist = specialistOverride(editedFields?.specialist, initialAgent?.specialist);
  const metadata = recordValue(initialAgent?.metadata) ?? {};
  const hasSpecialistEdit =
    typeof editedFields?.specialist === 'string' || editedFields?.specialist === null;
  const agentMetadata = hasSpecialistEdit ? withoutSpecialist(metadata) : metadata;

  // No client-supplied agentId: the daemon assigns the initial agent's id and
  // returns it on the `workspace.create` result. Strip any id carried on the
  // proposal payload so it never reaches the wire.
  const { agentId: _droppedAgentId, ...initialAgentFields } = initialAgent ?? {};

  return {
    ...params,
    repositoryPath: stringOverride(editedFields?.repoPath, params.repositoryPath),
    githubUrl: stringOverride(editedFields?.githubUrl, params.githubUrl),
    clonePath: stringOverride(editedFields?.clonePath, params.clonePath),
    baseRef: stringOverride(editedFields?.branch, params.baseRef),
    isNewRepo: booleanOverride(editedFields?.isNewRepo, params.isNewRepo),
    scope: stringOverride(editedFields?.scope, params.scope),
    initialAgent: {
      ...initialAgentFields,
      name: initialAgent?.name ?? 'Coordinator',
      prompt: stringOverride(editedFields?.initialPrompt, initialAgent?.prompt),
      specialist,
      agentType: initialAgent?.agentType ?? createAgentTypeId('workspace'),
      metadata: {
        ...agentMetadata,
        ...(specialist ? { specialist } : {}),
        isInitialAgent: true,
      },
    },
  };
}