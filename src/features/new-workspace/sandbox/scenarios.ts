import type { WorkspaceDraft } from '$shared/types/workspace-draft';
import { createInitialControllerState, type ControllerState } from '../controller';

export const SCENARIO_FAMILIES = [
  'entry',
  'capability',
  'source',
  'transaction',
  'recovery',
] as const;

export type ScenarioFamily = (typeof SCENARIO_FAMILIES)[number];

export const SANDBOX_ACTIONS = ['advance', 'reject', 'reconnect', 'lose-ack'] as const;

export type SandboxAction = (typeof SANDBOX_ACTIONS)[number];

export interface ScenarioFixtures {
  draft: WorkspaceDraft;
  host: {
    git: { state: 'available' | 'missing' | 'unknown'; version?: string };
    node: { state: 'available' | 'missing' | 'unknown'; version?: string };
  };
  provider: { state: 'ready' | 'missing' | 'login-required' | 'unknown'; provider?: string };
  workspace: Record<string, unknown>;
  initialAgent: Record<string, unknown>;
  attachmentPlacement: { placed: string[]; failed: string[] };
  sendResult: { messageId: string; queued: boolean };
}

export interface ScenarioScriptStep {
  channel: string;
  params?: Record<string, unknown>;
}

export interface Scenario {
  id: string;
  family: ScenarioFamily;
  title: string;
  initialControllerState: ControllerState;
  fixtures: ScenarioFixtures;
  allowedActions: readonly SandboxAction[];
  expectedPhase: string;
  script?: readonly ScenarioScriptStep[];
}

export const FIXED_IDS = {
  draft: '00000000-0000-4000-8000-000000000001',
  operation: '00000000-0000-4000-8000-000000000002',
  workspace: '00000000-0000-4000-8000-000000000003',
  agent: '00000000-0000-4000-8000-000000000004',
  message: '00000000-0000-4000-8000-000000000005',
} as const;

export const FIXED_TIMESTAMP = '2026-01-15T12:00:00.000Z';

export const DEFAULT_SCENARIO_FIXTURES: ScenarioFixtures = {
  draft: {
    id: FIXED_IDS.draft,
    ownerClientId: 'sandbox-client',
    revision: 1,
    phase: 'editing',
    intentText: '',
    source: null,
    contextLinks: [],
    attachments: [],
    config: {},
    operationKey: FIXED_IDS.operation,
    delivery: { state: 'none' },
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  },
  host: {
    git: { state: 'available', version: '2.51.0' },
    node: { state: 'available', version: '22.18.0' },
  },
  provider: { state: 'ready', provider: 'sandbox' },
  workspace: {
    id: FIXED_IDS.workspace,
    title: 'Untitled',
    status: 'active',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  },
  initialAgent: { id: FIXED_IDS.agent, name: 'Coordinator', status: 'idle' },
  attachmentPlacement: { placed: [], failed: [] },
  sendResult: { messageId: FIXED_IDS.message, queued: false },
};

function scenario(
  id: string,
  family: ScenarioFamily,
  title: string,
  expectedPhase: string,
  overrides: Partial<Scenario> = {},
): Scenario {
  return {
    id,
    family,
    title,
    initialControllerState: createInitialControllerState(0),
    fixtures: DEFAULT_SCENARIO_FIXTURES,
    allowedActions: ['advance', 'reject', 'reconnect', 'lose-ack'],
    expectedPhase,
    ...overrides,
  };
}

export const NEW_WORKSPACE_SCENARIOS: readonly Scenario[] = [
  scenario('entry-pristine', 'entry', 'Pristine draft', 'editing'),
  scenario('capability-no-provider', 'capability', 'Provider connection required', 'capability'),
  scenario('source-public-repo', 'source', 'Public repository selected', 'source'),
  scenario(
    'transaction-promoting',
    'transaction',
    'Promotion awaiting acknowledgement',
    'promoting',
    {
      script: [
        {
          channel: 'workspaceDraft.promote',
          params: { id: FIXED_IDS.draft, expectedRevision: 1 },
        },
      ],
    },
  ),
  scenario(
    'recovery-promotion-ack-lost',
    'recovery',
    'Promotion acknowledgement lost',
    'recovery',
    {
      script: [
        {
          channel: 'workspaceDraft.promote',
          params: { id: FIXED_IDS.draft, expectedRevision: 1 },
        },
      ],
    },
  ),
] as const;

export function validateScenarioRegistry(scenarios: readonly Scenario[]): string[] {
  const failures: string[] = [];
  const ids = new Set<string>();
  for (const item of scenarios) {
    if (!item.id.trim()) failures.push('Scenario id must not be empty.');
    if (ids.has(item.id)) failures.push(`Duplicate scenario id: ${item.id}`);
    ids.add(item.id);
  }
  for (const family of SCENARIO_FAMILIES) {
    if (!scenarios.some((item) => item.family === family)) {
      failures.push(`Missing scenario family: ${family}`);
    }
  }
  return failures;
}

export function getScenario(id: string | null | undefined): Scenario | undefined {
  return NEW_WORKSPACE_SCENARIOS.find((item) => item.id === id);
}
