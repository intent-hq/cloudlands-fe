import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { catalogNow } from '$lib/component-catalog/catalog-clock';
import { definePreview } from '$lib/component-catalog/preview-definition';
import {
  definePreviewFixture,
  PREVIEW_FIXTURE_TIMESTAMPS,
} from '$lib/component-catalog/preview-fixtures';
import { AgentStatus } from '$shared/types/agent.types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import {
  WorkspaceStatus,
  type AgentSession,
  type Workspace,
  type WorkspaceAgentInfo,
} from '$shared/types';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  connectionStatusChanged,
  systemStatusSuccess,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { store as appStore } from '$store/renderer/store';
import { getActiveBackendId } from '$store/renderer/utils/backend-storage-namespace';
import { CURRENT_PROTOCOL_VERSION } from '../../../test/current-protocol-version';

export type HudLeftColumnFleet = 'loaded' | 'loading' | 'attention' | 'failed' | 'empty';

export interface HudLeftColumnPreviewProps {
  fleet: HudLeftColumnFleet;
}

/** 3 days, 4 hours, 12 minutes. */
const UPTIME_SECONDS = 274_320;

type AgentSpec = [status: string, attention?: Pick<AgentSession, 'attentionRequestKind'>];

interface WorkspaceSpec {
  title: string;
  displayStatus: string;
  agents: AgentSpec[];
  attention?: Workspace['attention'];
  waiting?: boolean;
}

const workspaceFixture = definePreviewFixture<Workspace>({
  id: WorkspaceId('hud-preview-workspace'),
  title: 'HUD preview workspace',
  branch: 'main',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatus.Active,
  repositoryOwner: 'intent-hq',
  repositoryName: 'cloudlands-fe',
  ...PREVIEW_FIXTURE_TIMESTAMPS,
});

const running: AgentSpec = ['active'];
const idle: AgentSpec = ['idle'];
const errored: AgentSpec = ['error'];
const discussion: AgentSpec = ['idle', { attentionRequestKind: 'discussion' }];
const blocker: AgentSpec = ['idle', { attentionRequestKind: 'blocker' }];

const calmFleet: WorkspaceSpec[] = [
  { title: 'Add HUD previews', displayStatus: 'in_progress', agents: [running, idle] },
  { title: 'Polish dock spacing', displayStatus: 'in_progress', agents: [running] },
  { title: 'Migrate settings store', displayStatus: 'in_progress', agents: [running, running] },
  { title: 'Read verifier report', displayStatus: 'idle', agents: [idle], attention: 'unread' },
  { title: 'Plan release notes', displayStatus: 'idle', agents: [idle] },
  { title: 'Draft onboarding copy', displayStatus: 'not_started', agents: [] },
  {
    title: 'Monitor release queue',
    displayStatus: 'pr_open',
    agents: [idle],
    waiting: true,
  },
  { title: 'Review navigation flow', displayStatus: 'pr_ready', agents: [idle] },
  { title: 'Fix sidebar hover', displayStatus: 'pr_merged', agents: [] },
  { title: 'Ship dark theme tokens', displayStatus: 'complete', agents: [idle] },
  { title: 'Remove legacy rail', displayStatus: 'complete', agents: [] },
  { title: 'Tune burn chart', displayStatus: 'pr_open', agents: [] },
];

const fleets: Record<HudLeftColumnFleet, WorkspaceSpec[]> = {
  loaded: calmFleet,
  // Before workspace.list lands, only rows seeded by live events are in the store.
  loading: calmFleet.slice(0, 3),
  attention: [
    {
      title: 'Answer design question',
      displayStatus: 'needs_attention',
      agents: [discussion, running],
    },
    { title: 'Resolve access blocker', displayStatus: 'needs_attention', agents: [blocker] },
    { title: 'Approve migration plan', displayStatus: 'blocked', agents: [idle] },
    ...calmFleet.slice(0, 3),
  ],
  failed: [
    { title: 'Repair release checks', displayStatus: 'failed', agents: [errored, idle] },
    { title: 'Rebuild sandbox image', displayStatus: 'failed', agents: [errored] },
    ...calmFleet.slice(0, 2),
    calmFleet[9],
  ],
  empty: [],
};

const ATTENTION_REASONS: Record<string, string> = {
  discussion: 'Choose between a split view and tabs for the review pane.',
  blocker: 'The deploy key for the staging cluster was revoked.',
};

function buildFleet(fleet: HudLeftColumnFleet, nowMs: number) {
  const sessions: AgentSession[] = [];
  const workspaces = fleets[fleet].map((spec, index): Workspace => {
    const id = `hud-preview-${String(index + 1).padStart(2, '0')}`;
    const lastActivity = new Date(nowMs - (index + 1) * 4 * 60_000).toISOString();
    const agents: WorkspaceAgentInfo[] = spec.agents.map(([status, attention], agentIndex) => {
      const agent = {
        id: `${id}-agent-${agentIndex + 1}`,
        name: agentIndex === 0 ? 'Coordinator' : `Specialist ${agentIndex}`,
        status,
        lastActivity,
      };
      if (attention?.attentionRequestKind) {
        sessions.push({
          id: AgentId(agent.id),
          backendSessionId: null,
          workspaceId: WorkspaceId(id),
          name: agent.name,
          status: AgentStatus.RuntimeIdle,
          messages: [],
          createdAt: PREVIEW_FIXTURE_TIMESTAMPS.createdAt,
          updatedAt: lastActivity,
          attentionRequestKind: attention.attentionRequestKind,
          attentionRequestReason: ATTENTION_REASONS[attention.attentionRequestKind],
          attentionRequestTimestamp: lastActivity,
        });
      }
      return agent;
    });
    return workspaceFixture({
      id: WorkspaceId(id),
      title: spec.title,
      displayStatus: spec.displayStatus as Workspace['displayStatus'],
      attention: spec.attention ?? 'none',
      waiting: spec.waiting ?? false,
      agentSummary: {
        count: agents.length,
        agentIds: agents.map((agent) => agent.id),
        agents,
      } as Workspace['agentSummary'],
    });
  });
  return { workspaces, sessions };
}

/**
 * Seeds the renderer store the HUD left column reads, and puts the prior
 * workspace list and agent sessions back on dispose. Health stays seeded: the
 * daemon-health poll replaces it within one cycle in a live app.
 */
export function createHudLeftColumnPreview() {
  const before = appStore.state.workspace;
  const previousWorkspaces = getItems(before.workspaces);
  const previousHasLoaded = before.hasLoaded;
  const previousBackendId = before.loadedBackendId ?? undefined;
  const previousCapabilityContext = before.capabilityContext;
  let seededSessions: AgentSession[] = [];

  function clearSessions() {
    for (const session of seededSessions) appStore.dispatch(removeSession(session.id));
    seededSessions = [];
  }

  return {
    /** Returns the instant the fixture was stamped at, for the column's `nowMs`. */
    update(fleet: HudLeftColumnFleet): number {
      const nowMs = catalogNow();
      const { workspaces, sessions } = buildFleet(fleet, nowMs);
      clearSessions();
      appStore.dispatch(connectionStatusChanged('connected'));
      appStore.dispatch(
        systemStatusSuccess(
          {
            running: true,
            listenMode: 'both',
            version: '0.0.0-preview',
            protocolVersion: CURRENT_PROTOCOL_VERSION,
            uptimeSeconds: UPTIME_SECONDS,
            host: { os: 'linux', arch: 'x86_64', locality: 'local' },
          },
          new Date(nowMs).toISOString(),
          appStore.state.daemonHealth.connectionGeneration,
        ),
      );
      appStore.dispatch(replaceWorkspaceList(workspaces));
      appStore.dispatch(
        setWorkspaceHasLoaded(
          fleet !== 'loading',
          getActiveBackendId(appStore.state),
          previousCapabilityContext,
        ),
      );
      if (sessions.length > 0) {
        appStore.dispatch(bulkUpsertSessions(sessions, { preserveExplicitRuntimeFlags: false }));
      }
      seededSessions = sessions;
      return nowMs;
    },
    dispose() {
      clearSessions();
      appStore.dispatch(replaceWorkspaceList(previousWorkspaces));
      appStore.dispatch(
        setWorkspaceHasLoaded(previousHasLoaded, previousBackendId, previousCapabilityContext),
      );
    },
  };
}

const fleetState = (fleet: HudLeftColumnFleet) => ({ props: { fleet } });

export const hudLeftColumnPreview = definePreview<HudLeftColumnPreviewProps>({
  id: 'hud-left-column',
  title: 'Fleet HUD left column: system, agents and workspaces by state',
  defaultState: 'loaded',
  states: {
    loaded: fleetState('loaded'),
    // workspace.list has not answered: three event-seeded rows, a muted workspace count.
    loading: fleetState('loading'),
    attention: fleetState('attention'),
    failed: fleetState('failed'),
    empty: fleetState('empty'),
  },
});
