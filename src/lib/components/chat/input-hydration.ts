import type { AgentSession } from '$shared/types/agent-session';

export function resolveHydratedInputModel(
  session: Pick<AgentSession, 'model'> | null | undefined,
  fallbackAgentModel?: string,
): string | undefined {
  if (!session) {
    return undefined;
  }

  return session.model ?? fallbackAgentModel;
}