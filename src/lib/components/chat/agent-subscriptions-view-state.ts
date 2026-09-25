const eventSubscriptionsExpandedBySubscription = new Map<string, boolean>();
const waitingAgentsExpandedBySubscription = new Map<string, boolean>();
const finishedAgentsExpandedBySubscription = new Map<string, boolean>();
const expandedPrMonitorBySubscription = new Map<string, string | null>();

function disclosureKey(workspaceId: string, agentId: string): string {
  return `${workspaceId}:${agentId}`;
}

export function getEventSubscriptionsExpanded(workspaceId: string, agentId: string): boolean {
  return eventSubscriptionsExpandedBySubscription.get(disclosureKey(workspaceId, agentId)) ?? true;
}

export function setEventSubscriptionsExpanded(
  workspaceId: string,
  agentId: string,
  expanded: boolean,
): void {
  eventSubscriptionsExpandedBySubscription.set(disclosureKey(workspaceId, agentId), expanded);
}

export function getWaitingAgentsExpanded(workspaceId: string, agentId: string): boolean {
  return waitingAgentsExpandedBySubscription.get(disclosureKey(workspaceId, agentId)) ?? false;
}

export function setWaitingAgentsExpanded(
  workspaceId: string,
  agentId: string,
  expanded: boolean,
): void {
  waitingAgentsExpandedBySubscription.set(disclosureKey(workspaceId, agentId), expanded);
}

export function getFinishedAgentsExpanded(workspaceId: string, agentId: string): boolean {
  return finishedAgentsExpandedBySubscription.get(disclosureKey(workspaceId, agentId)) ?? false;
}

export function setFinishedAgentsExpanded(
  workspaceId: string,
  agentId: string,
  expanded: boolean,
): void {
  finishedAgentsExpandedBySubscription.set(disclosureKey(workspaceId, agentId), expanded);
}

export function getExpandedPrMonitorId(workspaceId: string, agentId: string): string | null {
  return expandedPrMonitorBySubscription.get(disclosureKey(workspaceId, agentId)) ?? null;
}

export function setExpandedPrMonitorId(
  workspaceId: string,
  agentId: string,
  monitorId: string | null,
): void {
  expandedPrMonitorBySubscription.set(disclosureKey(workspaceId, agentId), monitorId);
}

export function resetAgentSubscriptionsViewStateForTests(): void {
  eventSubscriptionsExpandedBySubscription.clear();
  waitingAgentsExpandedBySubscription.clear();
  finishedAgentsExpandedBySubscription.clear();
  expandedPrMonitorBySubscription.clear();
}
