import type { GenericAction } from '@themislib/themis/types';
import type { SelectorChannelSelector } from '@themislib/themis/saga';
import type {
  GitReadClient,
  PrRefreshResult,
} from '../../../../lib/client/lifecycle-read-client-types';
import type { PRStatusWorkspaceState } from '../pr-status/pr-status-types';
import type { SagaGenerator } from 'typed-redux-saga';
import type {
  AgentDelegatedCounts,
  AgentScopeCounts,
  AgentSession,
  Workspace,
} from '../../../../shared/types';
import type { HostRole } from '../../../../shared/types/principal';
import type { StoredAgentSession } from '../agent-session/agent-session-types';
import type { ScriptWithState } from '../scripts/scripts-types';
import type { TerminalTab } from '../terminals/terminals-slice';
import type {
  LifecycleReadClient,
  Metrics,
} from '../../../../lib/client/lifecycle-read-client-types';

/** Only the two fields read directly by the same-snapshot admission worker. */
export interface LifecycleReadState {
  connections: { windowBackendId: string };
  workspace: { capabilityContext: string | null };
}

type EffectSelector<Args extends unknown[], Result> = {
  effect: (...args: Args) => SagaGenerator<Result>;
};
type SnapshotSelector<State, Args extends unknown[], Result> = {
  select: (state: State, ...args: Args) => Result;
};

/** Required bindings to canonical named selectors; no local projection implementations. */
interface LifecycleReadSelectors<State extends LifecycleReadState> {
  selectAllWorkspaceScriptEntries: EffectSelector<[workspaceId: string], ScriptWithState[]>;
  selectAgentSessionWorkspaceId: EffectSelector<
    [agentId: string],
    AgentSession['workspaceId'] | undefined
  >;
  selectHostRole: SnapshotSelector<State, [], HostRole | null>;
  selectPrincipalActionContext: SnapshotSelector<State, [], string | null>;
  selectCurrentWorkspaceTabId: EffectSelector<[], string | null>;
  selectAgentSession: EffectSelector<[agentId?: string], StoredAgentSession | undefined>;
  selectAgentSessionsById: EffectSelector<[], Readonly<Record<string, AgentSession>>>;
  selectShouldRequestAgentLineStats: EffectSelector<
    [agentId: string, forceRefresh?: boolean],
    boolean
  >;
  selectPRStatusLastRefreshTime: EffectSelector<[workspaceId: string], number | null>;
  selectTerminalsForWorkspace: EffectSelector<[workspaceId: string], TerminalTab[]>;
  selectActiveAgentId: EffectSelector<[workspaceId: string], string | null>;
  selectWorkspaceAgentIds: EffectSelector<[workspaceId: string], string[]>;
  selectAllWorkspaceAgents: EffectSelector<[workspaceId?: string], AgentSession[]>;
  selectRetiredAgentsLoaded: EffectSelector<[workspaceId: string], boolean>;
  selectIsLoadingRetiredAgents: EffectSelector<[workspaceId: string], boolean>;
  selectDelegatedAgentsLoaded: EffectSelector<[workspaceId: string], boolean>;
  selectIsLoadingDelegatedAgents: EffectSelector<[workspaceId: string], boolean>;
  selectBackgroundAgentsLoaded: EffectSelector<[workspaceId: string], boolean>;
  selectIsLoadingBackgroundAgents: EffectSelector<[workspaceId: string], boolean>;
  selectOrphanedDelegatedAgentsLoaded: EffectSelector<[workspaceId: string], boolean>;
  selectIsLoadingOrphanedDelegatedAgents: EffectSelector<[workspaceId: string], boolean>;
  selectDelegatedParentLoaded: EffectSelector<
    [workspaceId: string, parentAgentId: string],
    boolean
  >;
  selectIsLoadingDelegatedParent: EffectSelector<
    [workspaceId: string, parentAgentId: string],
    boolean
  >;
  selectLoadedDelegatedParentIds: EffectSelector<[workspaceId: string], Record<string, boolean>>;
  selectScopeCounts: EffectSelector<[workspaceId: string], AgentScopeCounts | null>;
  selectDelegatedCounts: EffectSelector<[workspaceId: string], AgentDelegatedCounts | null>;
  selectScopeCountsGeneration: EffectSelector<[workspaceId: string], number>;
  selectOlderEventsNextToken: EffectSelector<[workspaceId: string], string | null>;
  selectDemandedTaskWorkspaceIds: EffectSelector<[], string[]>;
  selectWorkspaceTasksShouldLoad: EffectSelector<[workspaceId: string], boolean>;
  selectWorkspaceById: SnapshotSelector<State, [workspaceId: string], Workspace | undefined> &
    EffectSelector<[workspaceId: string], Workspace | undefined>;
  selectWorkspaceListLoadedForBackend: SnapshotSelector<State, [backendId: string], boolean>;
}

export interface LifecycleReadDependencies<
  State extends LifecycleReadState,
  ScriptContext extends { requestId: string },
> {
  selectors: LifecycleReadSelectors<State>;
  /** Opt-in only; the source facade supplies no physical Git ports. */
  scopedGit?: ScopedGitReadPorts<State>;
  appClient: LifecycleReadClient;
  getAgentLineStats: (agentId: string, workspaceId?: string) => Promise<Metrics | null>;
  beginScriptRead: (workspaceId: string) => SagaGenerator<ScriptContext>;
  isScriptReadCurrent: (context: ScriptContext) => SagaGenerator<boolean>;
  reconcileScriptRead: (
    context: ScriptContext,
    scripts: ScriptWithState[],
  ) => SagaGenerator<{ scripts: ScriptWithState[]; definitionChanges: Set<string> } | undefined>;
  refreshIntegrationAuthAfterReconnect: () => SagaGenerator<void>;
  /** Genuine list-only authority owner. React's combined authority/membership wrapper is incompatible. */
  workspaceAuthoritySaga: () => SagaGenerator<void>;
  /** Called once per root run; bind the canonical membership factory to this run's shared scheduler. */
  createMembershipSaga: (
    runRead: (
      workspaceId: string,
      read: (workspaceId: string) => SagaGenerator<void>,
    ) => SagaGenerator<void>,
  ) => () => SagaGenerator<void>;
}

export interface ScopedGitReadScope {
  readonly identity: object;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  release(): void;
  readonly reads: Pick<GitReadClient, 'status' | 'trackedChanges' | 'commitsWithBoundary'>;
  preparePrRefresh(): Promise<{
    readonly provenance: { readonly physicalOwnerId: string };
    isCurrent(): boolean;
    read(options: { automatic: boolean }): Promise<PrRefreshResult | null>;
  }>;
}

export interface ScopedGitReadPorts<State extends LifecycleReadState> {
  admission: SelectorChannelSelector<string | null, [workspaceId: string], State>;
  readCurrentContext(workspaceId: string): string | null;
  readMetadata(workspaceId: string): PRStatusWorkspaceState;
  getDispatch(): (action: GenericAction) => unknown;
  acquire(
    workspaceId: string,
    signal: AbortSignal,
  ): Promise<{ kind: 'unavailable' } | { kind: 'acquired'; scope: ScopedGitReadScope }>;
}
