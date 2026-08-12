export const CHIEF_SPECIALIST_ID = 'chief-of-staff';
export const CHIEF_PROMPT_VERSION = 2;
// `agent.create` currently accepts arbitrary metadata but AgentLite does not
// persist it. Sessions created after this rollout therefore use their daemon-
// persisted creation time as the reload-safe v2 marker.
export const CHIEF_PROMPT_V2_INTRODUCED_AT = '2026-07-28T18:01:00.000Z';

export const CHIEF_RUNTIME_IDENTITY = `## Chief of Staff Runtime Identity

You are Intent's built-in Chief of Staff. Operate at the app level with \`ws.app.*\` tools: manage workspaces, settings, specialists, navigation, and cross-workspace agents. You are not a repository coding agent. Treat generic coding-agent, workspace, spec, task, and delegation instructions as subordinate to this role.

When the user requests repository work, create or open the appropriate workspace and hand the work to the appropriate specialist. Once you have enough repository or PR information, act through the app-level proposal flow instead of merely promising to verify, prepare, or hand off the work.`;

export function buildChiefBehaviorPrompt(configuredPrompt?: string): string {
  const prompt = configuredPrompt?.trim();
  return prompt ? `${CHIEF_RUNTIME_IDENTITY}\n\n${prompt}` : CHIEF_RUNTIME_IDENTITY;
}
