/**
 * Dependency-light POSIX shell single-quoting (monorepo#579). Extracted per
 * AGENTS.md: utility functions must not be exported from orchestration
 * modules.
 *
 * Single quotes make the shell take the value fully literally — no `$VAR`
 * expansion, no backtick/`$(...)` command substitution, no `\` processing —
 * which double-quote escaping cannot guarantee (backticks still substitute
 * inside double quotes under `sh -c`).
 *
 * Caveat: this is POSIX-only. If the daemon host runs cmd.exe on Windows,
 * single quotes are not quoting characters there; callers targeting Windows
 * document that limitation at the call site rather than attempting a full
 * cmd.exe escaper here.
 */

/** POSIX single-quote `value` so the shell takes it literally (' → '\''). */
export function posixSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
