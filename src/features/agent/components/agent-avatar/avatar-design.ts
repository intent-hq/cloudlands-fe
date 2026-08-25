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

/** Whether a specialist `icon` value names one of the built-in avatar designs. */
export function isBuiltinAgentAvatarDesign(value: string): value is BuiltinAgentAvatarDesign {
  return (builtinAgentAvatarDesigns as readonly string[]).includes(value);
}

/**
 * Resolve the avatar design for an agent. Precedence: a valid specialist
 * `icon` (PROTOCOL §5.11) → the hard-coded specialist-id map → the seeded
 * fallback. Unknown/absent icons degrade to the pre-icon behavior.
 */
export function getAgentAvatarDesign(
  agentId: string,
  specialist?: string | null,
  icon?: string | null,
): AgentAvatarDesign {
  if (icon && isBuiltinAgentAvatarDesign(icon)) {
    return icon;
  }
  return builtinSpecialistAvatarDesigns[specialist ?? ''] ?? getFallbackAgentAvatarDesign(agentId);
}
