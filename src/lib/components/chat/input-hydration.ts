import type { AgentSession } from '$shared/types/agent-session';

export function resolveHydratedInputModel(
  session: Pick<AgentSession, 'model'> | null | undefined,
  _fallbackAgentModel?: string,
): string | null | undefined {
  if (!session) {
    return undefined;
  }

  // Return session.model directly without client-side fallback.
  // When session.model is null/undefined, the ModelPicker will show
  // "Default model" option instead of falling back to a hardcoded model id.
  return session.model;
}