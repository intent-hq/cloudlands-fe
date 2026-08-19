export const agentAvatarVariants = [
  'compact',
  'standard',
  'emphasized',
  'card-stack',
  'prominent',
] as const;

export type AgentAvatarVariant = (typeof agentAvatarVariants)[number];

export const agentAvatarGeometry = {
  compact: { surface: 16, art: 14, clearSpace: 1, radius: 5, ring: 1, overlap: 4 },
  standard: { surface: 20, art: 16, clearSpace: 2, radius: 6, ring: 1, overlap: 5 },
  emphasized: { surface: 24, art: 20, clearSpace: 2, radius: 7, ring: 1, overlap: 6 },
  'card-stack': { surface: 24, art: 20, clearSpace: 2, radius: 7, ring: 1, overlap: 6 },
  prominent: { surface: 40, art: 32, clearSpace: 4, radius: 12, ring: 2, overlap: 8 },
} as const satisfies Record<
  AgentAvatarVariant,
  {
    surface: number;
    art: number;
    clearSpace: number;
    radius: number;
    ring: number;
    overlap: number;
  }
>;

export const defaultAgentAvatarVariant = 'standard' satisfies AgentAvatarVariant;
