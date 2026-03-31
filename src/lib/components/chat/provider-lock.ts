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

function hasConversationStarted({
  messages,
  pendingInitialPrompt,
  pendingContextReferenceCount = 0,
}: Omit<ProviderLockStateInput, 'session'>): boolean {
  return (
    messages.length > 0 ||
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
  const sessionHandledPrompt = session ? hasAgentHandledFirstPrompt(session) : false;

  return (
    !sessionHandledPrompt &&
    !hasConversationStarted({
      messages,
      pendingInitialPrompt,
      pendingContextReferenceCount,
    })
  );
}
