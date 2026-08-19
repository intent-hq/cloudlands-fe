import { stringToSeededRandom } from '$lib/utils/hash';

export const fallbackAgentAvatarDesigns = [
  'fallback-glasses',
  'fallback-crown',
  'fallback-crown-inverted',
  'fallback-crown-mouth',
  'fallback-code',
  'fallback-dots',
] as const;

export const builtinAgentAvatarDesigns = [
  'coordinator',
  'implementor',
  'verifier',
  'pr-reviewer',
  'ui-designer',
  'chief-of-staff',
  'ralph',
] as const;

export type FallbackAgentAvatarDesign = (typeof fallbackAgentAvatarDesigns)[number];
export type BuiltinAgentAvatarDesign = (typeof builtinAgentAvatarDesigns)[number];
export type AgentAvatarDesign = BuiltinAgentAvatarDesign | FallbackAgentAvatarDesign;

export const builtinSpecialistAvatarDesigns: Readonly<Record<string, BuiltinAgentAvatarDesign>> = {
  coordinator: 'coordinator',
  'spec-writer': 'coordinator',
  implementor: 'implementor',
  verifier: 'verifier',
  developer: 'verifier',
  'pr-reviewer': 'pr-reviewer',
  'ui-designer': 'ui-designer',
  'chief-of-staff': 'chief-of-staff',
  ralph: 'ralph',
};

export function getFallbackAgentAvatarDesign(agentId: string): FallbackAgentAvatarDesign {
  return stringToSeededRandom(agentId).pick([...fallbackAgentAvatarDesigns]);
}

export function getAgentAvatarDesign(
  agentId: string,
  specialist?: string | null,
): AgentAvatarDesign {
  return builtinSpecialistAvatarDesigns[specialist ?? ''] ?? getFallbackAgentAvatarDesign(agentId);
}
