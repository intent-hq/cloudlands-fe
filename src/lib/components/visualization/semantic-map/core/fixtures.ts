import type { Assignment, Manifest, MapActivity, MapSource, Route } from './types';

const AGENT_EXECUTION_LABEL = 'Agent execution'; // i18n-ignore (daemon-shaped fixture)
const AGENT_EXECUTION_RESPONSIBILITY = 'This is where agent processes are created and coordinated.'; // i18n-ignore (daemon-shaped fixture)
const EVENT_STREAM_LABEL = 'Event stream'; // i18n-ignore (daemon-shaped fixture)
const EVENT_STREAM_RESPONSIBILITY =
  // i18n-ignore (daemon-shaped fixture)
  'This is where workspace activity is projected and distributed.';
const RENDERER_STATE_LABEL = 'Renderer state'; // i18n-ignore (daemon-shaped fixture)
const RENDERER_STATE_RESPONSIBILITY = 'This is where renderer domain state and selectors live.'; // i18n-ignore (daemon-shaped fixture)
const AGENT_EVENT_CROSSING_LABEL = 'Agent work becomes workspace activity.'; // i18n-ignore (daemon-shaped fixture)
const BACKEND_AGENT_NAME = 'Backend agent'; // i18n-ignore (daemon-shaped fixture)
const FRONTEND_AGENT_NAME = 'Frontend agent'; // i18n-ignore (daemon-shaped fixture)
const RESEARCH_AGENT_NAME = 'Research agent'; // i18n-ignore (daemon-shaped fixture)

export const SEMANTIC_MAP_FIXTURE_MANIFEST: Manifest = {
  version: 1,
  regions: [
    {
      id: 'agent-execution',
      label: AGENT_EXECUTION_LABEL,
      responsibility: AGENT_EXECUTION_RESPONSIBILITY,
      anchor: [0.25, 0.35],
      paths: ['packages/intentd/crates/intent-services/src/agents/**'],
    },
    {
      id: 'event-stream',
      label: EVENT_STREAM_LABEL,
      responsibility: EVENT_STREAM_RESPONSIBILITY,
      anchor: [0.52, 0.42],
      paths: ['packages/intentd/crates/intent-core/src/events/**'],
    },
    {
      id: 'renderer-state',
      label: RENDERER_STATE_LABEL,
      responsibility: RENDERER_STATE_RESPONSIBILITY,
      anchor: [0.78, 0.62],
      paths: ['packages/cloudlands-fe/src/store/renderer/**'],
    },
  ],
  crossings: [
    {
      from: 'agent-execution',
      to: 'event-stream',
      label: AGENT_EVENT_CROSSING_LABEL,
    },
  ],
};

export const SEMANTIC_MAP_FIXTURE_SOURCE: MapSource = 'curated';

export const SEMANTIC_MAP_FIXTURE_ASSIGNMENTS: Assignment[] = [
  { regionId: 'agent-execution', confidence: 'curated' },
  { regionId: 'event-stream', confidence: 'curated' },
  { regionId: 'renderer-state', confidence: 'curated' },
];

export const SEMANTIC_MAP_FIXTURE_ACTIVITIES: MapActivity[] = [
  {
    regionId: 'agent-execution',
    agentId: 'agent-1',
    agentName: BACKEND_AGENT_NAME,
    path: 'packages/intentd/crates/intent-services/src/agents/mod.rs',
    kind: 'read',
    ts: '2026-09-06T02:00:00.000Z',
  },
  {
    regionId: 'event-stream',
    agentId: 'agent-1',
    agentName: BACKEND_AGENT_NAME,
    path: 'packages/intentd/crates/intent-core/src/events/mod.rs',
    kind: 'edit',
    ts: '2026-09-06T02:01:00.000Z',
  },
  {
    regionId: 'renderer-state',
    agentId: 'agent-2',
    agentName: FRONTEND_AGENT_NAME,
    path: 'packages/cloudlands-fe/src/store/renderer/reducer.ts',
    kind: 'create',
    ts: '2026-09-06T02:02:00.000Z',
  },
  {
    agentId: 'agent-3',
    agentName: RESEARCH_AGENT_NAME,
    kind: 'thinking',
    ts: '2026-09-06T02:03:00.000Z',
  },
];

export const SEMANTIC_MAP_FIXTURE_ROUTE: Route = {
  visits: ['agent-execution', 'event-stream'],
  transitions: [
    {
      from: 'agent-execution',
      to: 'event-stream',
      count: 1,
      evidence: ['packages/intentd/crates/intent-core/src/events/mod.rs'],
      label: AGENT_EVENT_CROSSING_LABEL,
    },
  ],
};
