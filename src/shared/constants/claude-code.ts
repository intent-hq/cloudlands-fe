/**
 * Claude Code (claude-agent-acp) constants shared by Electron and renderer
 * availability handlers. intentd owns the adapter package/version — it spawns
 * the adapter, so no pin lives here.
 */

/** User-facing warning when discovery reports the adapter unavailable and npx missing. */
export const CLAUDE_CODE_NPX_MISSING_WARNING =
  'npx not found — install Node.js (with npm) to use Claude Code';
