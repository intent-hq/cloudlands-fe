/**
 * Codex (codex-acp) constants for the renderer mock-router seeders, in the
 * shareable constants pattern of `constants/claude-code.ts`.
 */

/**
 * User-facing warning when the codex CLI is installed but the ACP adapter
 * cannot run: neither a local `codex-acp` binary nor npx (which runs the
 * adapter package intentd pins) is available.
 */
export const CODEX_ADAPTER_MISSING_WARNING =
  'codex-acp and npx not found — install Node.js (with npm) or the codex-acp adapter to use Codex';
