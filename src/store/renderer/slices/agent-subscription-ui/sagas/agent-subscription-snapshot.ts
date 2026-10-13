import type {
  Subscription,
  DelegationGroupStatus,
  AgentStatus,
  EventSubscription,
} from '../agent-subscription-ui-types';

type WireSubscription = Omit<Subscription, 'delegationGroup'> & {
  delegationGroup?: Subscription['delegationGroup'] | null;
};

type WireDelegationGroup = Omit<DelegationGroupStatus, 'agentStatuses'> & {
  parentAgentId?: string;
};

export interface WireResult {
  /** Optional for daemons predating bundled slim agent.list projections. */
  agents?: Record<string, unknown>[];
  subscriptions?: WireSubscription[];
  eventSubscriptions?: EventSubscription[];
  delegationGroups?: WireDelegationGroup[];
  agentStatuses?: Record<string, AgentStatus>;
}

export function mapResult(result: WireResult) {
  const agentStatuses = result.agentStatuses ?? {};
  const subscriptions: Subscription[] = (result.subscriptions ?? []).map((item) => ({
    id: item.id,
    agentId: item.agentId,
    eventTypes: item.eventTypes,
    actorIds: item.actorIds,
    createdAt: item.createdAt,
    description: item.description,
    ...(item.delegationGroup ? { delegationGroup: item.delegationGroup } : {}),
  }));
  const delegationGroups: DelegationGroupStatus[] = (result.delegationGroups ?? []).map(
    (group) => ({
      groupId: group.groupId,
      awaitMode: group.awaitMode,
      expectedAgentIds: group.expectedAgentIds,
      completedAgentIds: group.completedAgentIds,
      deletedAgentIds: group.deletedAgentIds,
      agentStatuses: Object.fromEntries(
        group.expectedAgentIds
          .filter((id) => agentStatuses[id] !== undefined)
          .map((id) => [id, agentStatuses[id]]),
      ),
      delivered: group.delivered,
    }),
  );
  return {
    subscriptions,
    delegationGroups,
    agentStatuses,
    ...(result.eventSubscriptions !== undefined
      ? { eventSubscriptions: result.eventSubscriptions }
      : {}),
  };
}
