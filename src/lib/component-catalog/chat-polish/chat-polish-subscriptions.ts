import type { ChatPolishSubscriptionFixture } from './chat-polish-types';

export const chatPolishSubscriptionFixtures: ChatPolishSubscriptionFixture[] = [
  { id: 'subscriptions-0', agentCount: 0, expanded: true },
  { id: 'subscriptions-1-expanded', agentCount: 1, expanded: true },
  { id: 'subscriptions-6-expanded', agentCount: 6, expanded: true },
  { id: 'subscriptions-7-collapsed', agentCount: 7, expanded: false },
  { id: 'subscriptions-7-expanded', agentCount: 7, expanded: true },
];

export function getChatPolishSubscriptionFixture(
  id: string,
): ChatPolishSubscriptionFixture | undefined {
  return chatPolishSubscriptionFixtures.find((fixture) => fixture.id === id);
}

export function subscriptionAgentIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `fixture-agent-${index + 1}`);
}
