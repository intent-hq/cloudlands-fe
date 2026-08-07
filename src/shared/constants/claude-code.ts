/**
 * Claude Code (claude-agent-acp) constants shared between the main-process
 * availability probe and the renderer mock-router seeders. intentd owns the
 * adapter package/version — it spawns the adapter, so no pin lives here.
 */

/** User-facing warning when the claude CLI is present but npx is not. */
export const CLAUDE_CODE_NPX_MISSING_WARNING =
  'npx not found — install Node.js (with npm) to use Claude Code';
