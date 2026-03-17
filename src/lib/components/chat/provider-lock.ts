import type { AgentSession } from '$shared/types/agent-session';
import { hasAgentHandledFirstPrompt } from '$shared/types/agent-session';

interface MessageLike {
  role?: string;
}

interface ProviderLockStateInput {
  session: AgentSession | null;
  messages: MessageLike[];
  pendingInitialPrompt?: string | null;
  pendingContextReferenceCount?: number;
}

function hasVisibleFirstUserMessage({
  messages,
  pendingInitialPrompt,
  pendingContextReferenceCount = 0,
}: Omit<ProviderLockStateInput, 'session'>): boolean {
  return (
    messages.some((message) => message.role === 'user') ||
    Boolean(pendingInitialPrompt) ||
    pendingContextReferenceCount > 0
  );
}

export function canChangeAgentProvider({
  session,
  messages,
  pendingInitialPrompt,
  pendingContextReferenceCount = 0,
}: ProviderLockStateInput): boolean {
  if (!session) {
    return true;
  }

  return (
    !hasAgentHandledFirstPrompt(session) &&
    !hasVisibleFirstUserMessage({
      messages,
      pendingInitialPrompt,
      pendingContextReferenceCount,
    })
  );
}
