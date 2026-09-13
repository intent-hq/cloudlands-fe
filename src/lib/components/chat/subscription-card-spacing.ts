import { extractAllContent, type AgentMessage } from '$shared/types';
import { getAgentMessageAttribution } from '$lib/utils/agent-message-attribution';
import { getAutomatedWakePresentation } from './automated-wake-presentation';

export type SubscriptionCardSeam = 'cards' | 'content';

/** Human and queued messages have the same filled boundary as notification cards. */
export function isChatCardMessage(message: AgentMessage | null | undefined): boolean {
  return message?.role === 'user';
}

/** Match the card presentations, not every automated user-role message. */
export function isSubscriptionCardMessage(message: AgentMessage | null | undefined): boolean {
  if (!message || message.role !== 'user') return false;
  return Boolean(
    getAgentMessageAttribution(message.metadata) ||
    getAutomatedWakePresentation(message) ||
    message.metadata?.type === 'event_notification' ||
    extractAllContent(message).trim().startsWith('[WORKSPACE EVENTS]'),
  );
}

/** The parent owns the whole seam; card children must suppress their top margins. */
export function getSubscriptionCardSeam(
  previousIsCard: boolean,
  currentIsCard: boolean,
): SubscriptionCardSeam | undefined {
  if (previousIsCard && currentIsCard) return 'cards';
  if (previousIsCard || currentIsCard) return 'content';
  return undefined;
}
