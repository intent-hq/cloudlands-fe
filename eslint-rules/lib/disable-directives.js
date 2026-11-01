/**
 * Reads `eslint-disable*` comments the way ESLint does, for rules that need to know
 * where they are turned off: a baselined rule counts only unsuppressed findings (so its
 * per-file count matches what ESLint reports), and a rule can require that a directive
 * naming it gives a reason.
 */

const DIRECTIVE =
  /^\s*eslint-(disable|enable|disable-line|disable-next-line)(?:\s+(?!--)([^]*?))?(?:\s+--(?:\s+([^]*?))?)?\s*$/;

/**
 * Every `eslint-disable*` / `eslint-enable` comment in the file:
 * `{ comment, kind, rules, reason }`, where `rules` is `null` for a directive that names
 * no rule (it covers every rule) and `reason` is the text after `--`, or `''`.
 */
export function disableDirectives(sourceCode) {
  const directives = [];
  for (const comment of sourceCode.getAllComments()) {
    const match = DIRECTIVE.exec(comment.value);
    if (!match) continue;
    const [, kind, list, reason] = match;
    // `eslint-disable-line` must be a line comment or a block on one line, as in ESLint.
    if (
      kind !== 'disable' &&
      kind !== 'enable' &&
      comment.loc.start.line !== comment.loc.end.line
    ) {
      continue;
    }
    if ((kind === 'disable' || kind === 'enable') && comment.type !== 'Block') continue;
    const rules = list
      ? list
          .split(',')
          .map((rule) => rule.trim())
          .filter(Boolean)
      : null;
    directives.push({ comment, kind, rules, reason: (reason ?? '').trim() });
  }
  return directives;
}

/** Whether a directive's rule list covers `ruleName` (bare or plugin-prefixed). */
export function namesRule(directive, ruleName) {
  if (!directive.rules) return true;
  return directive.rules.some((rule) => rule === ruleName || rule.endsWith(`/${ruleName}`));
}

/** `(line) => boolean`: whether an `eslint-disable*` directive turns `ruleName` off there. */
export function suppressedLines(sourceCode, ruleName) {
  const lines = new Set();
  const ranges = [];
  let openFrom = null;
  for (const directive of disableDirectives(sourceCode)) {
    if (!namesRule(directive, ruleName)) continue;
    const { comment, kind } = directive;
    if (kind === 'disable-line') lines.add(comment.loc.start.line);
    else if (kind === 'disable-next-line') lines.add(comment.loc.end.line + 1);
    else if (kind === 'disable' && openFrom === null) openFrom = comment.loc.start.line;
    else if (kind === 'enable' && openFrom !== null) {
      ranges.push([openFrom, comment.loc.start.line]);
      openFrom = null;
    }
  }
  if (openFrom !== null) ranges.push([openFrom, Infinity]);
  return (line) => lines.has(line) || ranges.some(([from, to]) => line >= from && line <= to);
}
