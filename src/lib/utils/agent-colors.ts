/**
 * Agent Color System
 *
 * Provides unique colors for each agent with gradient variations.
 * Colors are deterministically assigned based on agent ID.
 */

import { stringToSeededRandom } from '$lib/utils/hash';

// Define a vibrant color palette for agents
export const AGENT_COLOR_PALETTE = [
  { name: 'violet', base: '#8B5CF6', start: '#A78BFA', end: '#7C3AED' },
  { name: 'blue', base: '#3B82F6', start: '#60A5FA', end: '#2563EB' },
  { name: 'emerald', base: '#10B981', start: '#34D399', end: '#059669' },
  { name: 'amber', base: '#F59E0B', start: '#FBB040', end: '#D97706' },
  { name: 'rose', base: '#F43F5E', start: '#FB7185', end: '#E11D48' },
  { name: 'cyan', base: '#06B6D4', start: '#22D3EE', end: '#0891B2' },
  { name: 'lime', base: '#84CC16', start: '#A3E635', end: '#65A30D' },
  { name: 'pink', base: '#EC4899', start: '#F472B6', end: '#DB2777' },
  { name: 'indigo', base: '#6366F1', start: '#818CF8', end: '#4F46E5' },
  { name: 'orange', base: '#FB923C', start: '#FDBA74', end: '#EA580C' },
  { name: 'teal', base: '#14B8A6', start: '#2DD4BF', end: '#0D9488' },
  { name: 'purple', base: '#A855F7', start: '#C084FC', end: '#9333EA' },
];

export interface AgentColor {
  name: string;
  base: string;
  start: string;
  end: string;
  gradient: string;
  focusRing: string;
}

// Store assigned colors to ensure consistency
const assignedColors = new Map<string, AgentColor>();
let colorIndex = 0;

/**
 * Get a unique color for an agent based on their ID
 * Colors are deterministically assigned and cached
 */
export function getAgentColor(agentId: string): AgentColor {
  // Return cached color if already assigned
  if (assignedColors.has(agentId)) {
    return assignedColors.get(agentId)!;
  }

  // Use seeded random for deterministic color selection
  const random = stringToSeededRandom(agentId);
  const colorData = random.pick(AGENT_COLOR_PALETTE);

  // Create the color object with computed properties
  const color: AgentColor = {
    name: colorData.name,
    base: colorData.base,
    start: colorData.start,
    end: colorData.end,
    gradient: `linear-gradient(135deg, ${colorData.start} 0%, ${colorData.end} 100%)`,
    focusRing: `0 0 0 3px ${colorData.base}40, 0 0 0 1px ${colorData.base}`,
  };

  // Cache the assignment
  assignedColors.set(agentId, color);

  return color;
}

/**
 * Get a CSS variable-friendly version of the agent color
 */
export function getAgentColorCSSVars(agentId: string): Record<string, string> {
  const color = getAgentColor(agentId);
  return {
    '--agent-color-base': color.base,
    '--agent-color-start': color.start,
    '--agent-color-end': color.end,
    '--agent-gradient': color.gradient,
    '--agent-focus-ring': color.focusRing,
  };
}

/**
 * Clear the color assignment for an agent
 */
export function clearAgentColor(agentId: string): void {
  assignedColors.delete(agentId);
}

/**
 * Clear all color assignments
 */
export function clearAllAgentColors(): void {
  assignedColors.clear();
  colorIndex = 0;
}

/**
 * Get a subtle background color for agent UI elements
 */
export function getAgentBackgroundColor(agentId: string, opacity: number = 0.1): string {
  const color = getAgentColor(agentId);
  // Convert hex to rgba with opacity
  const hex = color.base.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Generate a unique avatar gradient for an agent
 */
export function getAgentAvatarGradient(agentId: string): string {
  const color = getAgentColor(agentId);
  // Create a radial gradient for avatar backgrounds
  return `radial-gradient(circle at 30% 30%, ${color.start}, ${color.end})`;
}
