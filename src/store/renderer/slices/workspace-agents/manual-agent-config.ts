import type { UnifiedAgentConfig } from '$shared/types/agent.types';
import { createAgentTypeId, parseAgentTypeId } from '$shared/types/agent.types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { generateSpecialistAgentName } from '$lib/utils/agent-name-generator';

/** Canonical manual creation naming/triple; explicit null is the General-agent choice. */
export function buildManualAgentConfig(input: {
  workspaceId: string;
  existingNames: string[];
  model?: string;
  provider: string;
  selectedSpecialistId?: string | null;
  specialistId?: string;
  baseName?: string;
  agentType?: string;
  behaviorPrompt?: string;
  reasoningEffort?: string;
}): UnifiedAgentConfig {
  return {
    name: generateSpecialistAgentName(input.baseName ?? 'Agent', input.existingNames),
    nameExplicitlySet: false,
    workspaceId: WorkspaceId(input.workspaceId),
    model: input.model,
    provider: input.provider,
    agentType: (input.agentType && parseAgentTypeId(input.agentType)) || createAgentTypeId('chat'),
    behaviorPrompt: input.behaviorPrompt,
    reasoningEffort: input.reasoningEffort,
    source: input.selectedSpecialistId === undefined ? 'keyboard-shortcut' : 'specialist-picker',
    rememberSpecialist: input.selectedSpecialistId !== undefined ? true : undefined,
    metadata: input.specialistId ? { specialist: input.specialistId } : undefined,
  };
}
