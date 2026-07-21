/**
 * Codex (codex-acp) constants for the renderer mock-router seeders, in the
 * shareable constants pattern of `constants/claude-code.ts`. The main-process
 * resolver does not consume these yet — it installs a managed codex-acp as a
 * fallback instead of warning — but may import them if a warning is added.
 */

/**
 * User-facing warning when the codex CLI is installed but the ACP adapter
 * cannot run: neither a local `codex-acp` binary nor npx (which runs the
 * version-pinned `@zed-industries/codex-acp` fallback — see
 * CODEX_ACP_NPX_PACKAGE in codex-resolver) is available.
 */
export const CODEX_ADAPTER_MISSING_WARNING =
  'codex-acp and npx not found — install Node.js (with npm) or the codex-acp adapter to use Codex';
