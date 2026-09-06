import type { WorkspaceEvent } from '$features/events/types';
import type { MapActivity, MapActivityKind, Route } from './core/types';

export const SCRIPT_START = '2026-09-06T10:00:00.000Z';
export const SCRIPT_DURATION_MINUTES = 20;

export const SCRIPT_AGENTS = [
  {
    id: 'agent-daemon',
    name: 'Mina',
    regions: ['agent-execution', 'event-stream', 'transport-rpc'],
  },
  {
    id: 'agent-renderer',
    name: 'Quinn',
    regions: ['protocol-client', 'renderer-state', 'renderer-ui'],
  },
  {
    id: 'agent-research',
    name: 'Sol',
    regions: ['notes-tasks-spec', 'tools-integrations', 'git-pr'],
  },
] as const;

interface ScriptStep {
  minute: number;
  agentIndex: number;
  regionId: string;
  kind: Extract<MapActivityKind, 'read' | 'edit' | 'tool' | 'thinking'>;
  path?: string;
}

export interface SemanticMapScript {
  workspaceEvents: WorkspaceEvent[];
  activities: MapActivity[];
  routes: Record<string, Route>;
}

const pathsByRegion: Record<string, string> = {
  'agent-execution': 'packages/intentd/crates/intent-services/src/agent_ops.rs',
  'event-stream': 'packages/intentd/crates/intent-core/src/events/mod.rs',
  'transport-rpc': 'packages/intentd/crates/intent-transport/src/router.rs',
  'protocol-client': 'packages/cloudlands-fe/src/lib/client/app-client.ts',
  'renderer-state': 'packages/cloudlands-fe/src/store/renderer/reducer.ts',
  'renderer-ui':
    'packages/cloudlands-fe/src/lib/components/visualization/semantic-map/SemanticMapCanvas.svelte',
  'notes-tasks-spec': 'packages/intentd/crates/intent-services/src/note_ops.rs',
  'tools-integrations': 'packages/intentd/crates/intent-services/src/browser_ops.rs',
  'git-pr': 'packages/intentd/crates/intent-services/src/pr_ops.rs',
};

function atMinute(minute: number): string {
  return new Date(Date.parse(SCRIPT_START) + minute * 60_000).toISOString();
}

function createSteps(): ScriptStep[] {
  return Array.from({ length: SCRIPT_DURATION_MINUTES + 1 }, (_, minute) => {
    const agentIndex = minute % SCRIPT_AGENTS.length;
    const agent = SCRIPT_AGENTS[agentIndex];
    const regionId =
      agent.regions[Math.floor(minute / SCRIPT_AGENTS.length) % agent.regions.length];
    const kind = (['read', 'edit', 'tool', 'thinking'] as const)[minute % 4];
    return { minute, agentIndex, regionId, kind, path: pathsByRegion[regionId] };
  });
}

function toWorkspaceEvent(step: ScriptStep, index: number): WorkspaceEvent {
  const agent = SCRIPT_AGENTS[step.agentIndex];
  const base = {
    id: `semantic-map-event-${index}`,
    workspaceId: 'semantic-map-preview',
    timestamp: atMinute(step.minute),
    actor: { type: 'agent' as const, id: agent.id, name: agent.name },
  };
  if (step.kind === 'edit') {
    return {
      ...base,
      type: 'file:changed',
      data: { path: step.path, relativePath: step.path, action: 'modify' },
    };
  }
  if (step.kind === 'thinking') {
    return {
      ...base,
      type: 'agent:message',
      data: {
        messageId: `semantic-map-message-${index}`,
        turnNumber: index,
        content: '',
        reasoning: 'active',
      },
    };
  }
  return {
    ...base,
    type: 'agent:tool:call',
    data: {
      toolName: step.kind === 'read' ? 'view' : 'terminal',
      toolKind: step.kind === 'read' ? 'file' : 'terminal',
      input: step.kind === 'read' ? { path: step.path } : { command: 'pnpm check' },
      status: 'completed',
    },
  };
}

export function createSemanticMapScript(): SemanticMapScript {
  const steps = createSteps();
  return {
    workspaceEvents: steps.map(toWorkspaceEvent),
    activities: steps.map((step, index) => ({
      id: `semantic-map-event-${index}`,
      regionId: step.regionId,
      agentId: SCRIPT_AGENTS[step.agentIndex].id,
      agentName: SCRIPT_AGENTS[step.agentIndex].name,
      path: step.kind === 'read' || step.kind === 'edit' ? step.path : undefined,
      kind: step.kind,
      ts: atMinute(step.minute),
    })),
    routes: {
      'agent-daemon': route(
        ['agent-execution', 'event-stream', 'transport-rpc'],
        [
          // i18n-ignore (daemon-shaped crossing label fixture)
          'ACP updates become agent lifecycle and activity events',
        ],
      ),
      'agent-renderer': route(
        ['protocol-client', 'renderer-state', 'renderer-ui'],
        [
          undefined,
          // i18n-ignore (daemon-shaped crossing label fixture)
          'selectors turn synchronized state into visible product surfaces',
        ],
      ),
      'agent-research': route(['notes-tasks-spec', 'tools-integrations', 'git-pr']),
    },
  };
}

function route(visits: string[], labels: Array<string | undefined> = []): Route {
  return {
    visits,
    transitions: visits.slice(1).map((to, index) => ({
      from: visits[index],
      to,
      count: index + 1,
      evidence: [pathsByRegion[to]],
      label: labels[index],
    })),
  };
}
