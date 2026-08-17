import type { AvatarState } from './avatar-state';
import {
  builtinAgentAvatarDesigns,
  fallbackAgentAvatarDesigns,
  getFallbackAgentAvatarDesign,
  type AgentAvatarDesign,
} from './avatar-design';

export const agentAvatarCatalogStates: readonly AvatarState[] = [
  'running',
  'responding',
  'unread',
  'completed',
  'failed',
  'waiting',
  'needs-permission',
  'attention-discussion',
  'attention-blocker',
  'idle',
];

const specialistByDesign = {
  coordinator: 'coordinator',
  implementor: 'implementor',
  verifier: 'verifier',
  'pr-reviewer': 'pr-reviewer',
  'ui-designer': 'ui-designer',
  'chief-of-staff': 'chief-of-staff',
  ralph: 'ralph',
} satisfies Record<(typeof builtinAgentAvatarDesigns)[number], string>;

function findFallbackAgentId(design: (typeof fallbackAgentAvatarDesigns)[number]): string {
  for (let index = 0; index < 1000; index += 1) {
    const agentId = `agent-avatar-catalog-${index}`;
    if (getFallbackAgentAvatarDesign(agentId) === design) return agentId;
  }
  throw new Error(`No catalog seed found for ${design}`);
}

export interface AgentAvatarCatalogIdentity {
  design: AgentAvatarDesign;
  agentId: string;
  specialist: string | null;
}

export const agentAvatarCatalogIdentities: readonly AgentAvatarCatalogIdentity[] = [
  ...builtinAgentAvatarDesigns.map((design) => ({
    design,
    agentId: `agent-avatar-catalog-${design}`,
    specialist: specialistByDesign[design],
  })),
  ...fallbackAgentAvatarDesigns.map((design) => ({
    design,
    agentId: findFallbackAgentId(design),
    specialist: null,
  })),
];

export const agentAvatarFixtures = [
  {
    id: 'agent-avatar-design-status-matrix',
    title: 'agent-avatar-design-status-matrix', // i18n-ignore (catalog fixture identifier)
    states: [
      ...builtinAgentAvatarDesigns,
      ...fallbackAgentAvatarDesigns,
      ...agentAvatarCatalogStates,
    ],
    themes: ['light', 'dark', 'high-contrast'],
    viewport: 'both',
    reducedMotion: true,
  },
] as const;
