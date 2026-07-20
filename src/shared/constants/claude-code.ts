/**
 * Claude Code (claude-agent-acp) constants shared between the main-process
 * resolver and the renderer mock-router seeders.
 */

/** npm package that provides the Claude Code ACP adapter. */
export const CLAUDE_AGENT_ACP_PACKAGE = '@agentclientprotocol/claude-agent-acp';

/**
 * Pinned adapter version. Must stay in sync with the intentd provider config
 * (`claude-code` npx spawn) so both stacks run the same adapter release.
 * Bumping this is a deliberate code change.
 */
export const CLAUDE_AGENT_ACP_VERSION = '0.60.0';

/** Full `package@version` spec passed to `npx -y`. */
export const CLAUDE_AGENT_ACP_NPX_SPEC = `${CLAUDE_AGENT_ACP_PACKAGE}@${CLAUDE_AGENT_ACP_VERSION}`;

/** User-facing warning when the claude CLI is present but npx is not. */
export const CLAUDE_CODE_NPX_MISSING_WARNING =
  'npx not found — install Node.js 18+ to use Claude Code';
