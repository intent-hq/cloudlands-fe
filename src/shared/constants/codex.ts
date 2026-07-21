/**
 * Codex (codex-acp) constants shared between the main-process resolver and
 * the renderer mock-router seeders.
 */

/**
 * User-facing warning when the codex CLI is installed but the ACP adapter
 * cannot run: neither a local `codex-acp` binary nor npx (the pinned
 * `npx -y @zed-industries/codex-acp` fallback runner) is available.
 */
export const CODEX_ADAPTER_MISSING_WARNING =
  'codex-acp and npx not found — install Node.js (with npm) or the codex-acp adapter to use Codex';
