// @ui-invariant
//
// Avatar-state comparison inventory.
//
// Incident: intent-hq/cloudlands-fe#2327 made `getAvatarStateForSession`
// derive `question` from the session. `NotesPanel.svelte` gated its agent
// strip on `state !== 'running'`, so a running agent with an open question —
// which outranks `running` in the ladder — vanished from the strip. Two
// verifier passes missed it; the PR reviewer caught it
// (https://github.com/intent-hq/cloudlands-fe/pull/2327#discussion_r3986358003).
//
// Rule: the `AvatarState` ladder in `avatar-state.ts` is a DISPLAY precedence,
// not an activity predicate. Visibility / inclusion decisions must use
// `isSessionRunning` / `isAgentActivelyWorking` (or another activity
// predicate), never `getAvatarState*(…) === '<literal>'`. Display mappings
// (glow colour, sort rank, label branch) may compare and are recorded in
// `ALLOWLIST` as `kind: 'display'`. A comparison that decides whether
// something is shown / included is `kind: 'gate'`: pre-existing gates are
// recorded as migration debt with a `followUp` naming the predicate to move
// to, and the number of gate entries is ratcheted by `GATE_DEBT_CEILING` —
// lower it as gates migrate, never raise it. New gates are not accepted; this
// test does not change any caller's behaviour.
//
// Site identity: one allowlist entry covers exactly one comparison site —
// `path` + the whitespace-normalised `comparison` text, plus a `context`
// substring of the line when the same comparison appears more than once in a
// file. A second identical comparison elsewhere in the file, or a new
// comparison added to an already-allowlisted line, therefore fails.
//
// Detection is regex plus bracket-balanced source inspection, not a type
// checker:
//  - Scope: production `src/**/*.{ts,svelte}` minus `*.test.*` / `*.spec.*`,
//    `__tests__/`, `*.stories.*`, `src/routes/sandbox`, and the ladder module.
//  - Ladder-valued identifiers per file: a `const`/`let`/`var` whose
//    initializer calls `getAvatarState*`; an identifier annotated
//    `: AvatarState` (parameters, props, object type members); an
//    object-literal property fed by a `getAvatarState*` call; a `function`
//    declared to return `AvatarState`; and any identifier compared to a literal
//    that exists only in the ladder (`needs-permission`, `attention-*`), which
//    reaches helpers such as `sidebar-launcher-preview.ts` that accept the
//    state as `string`.
//  - Flagged forms: `<ident> === '<literal>'` / `!==` in either operand order
//    (member access such as `row.state` matches by property name),
//    `switch (<ident>)`, and a direct `getAvatarState*(…)` or
//    `<fn returning AvatarState>(…)` call compared to a literal, again in
//    either operand order.
//  - Limits: cross-file flow through `string`/untyped parameters is caught only
//    by the ladder-only-literal rule; destructured bindings, `.includes(…)`,
//    `Set.has(…)`, lookup tables, and comparisons against a variable holding a
//    literal are not detected. Selector calls are matched by their canonical
//    names, so an aliased import (`import { getAvatarState as x }`) is not
//    followed. A wrapper without an explicit `: AvatarState` return annotation
//    (`function stateOf(s) { return getAvatarStateForSession(s); }`) is not
//    tracked, and even a recognised typed wrapper's result assigned to an
//    unannotated variable is not tracked transitively. Reassignment
//    (`row.state = …`), parenthesised/cast operands, and member access on the
//    literal's opposite side are only partially covered; comments and strings
//    are not stripped before matching.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LADDER_PATH = 'src/features/agent/components/agent-avatar/avatar-state.ts';
const INVENTORY_PATH =
  'src/features/agent/components/agent-avatar/avatar-state-gate-inventory.test.ts';
const LADDER_FUNCTION = /\bgetAvatarState(?:ForSession|FromStore)?\b/;
const LADDER_ONLY_LITERALS = ['needs-permission', 'attention-discussion', 'attention-blocker'];
const EXCLUDED_FILE = /\.(?:test|spec|stories)\./;
const EXCLUDED_DIRECTORIES = new Set(['__tests__', 'src/routes/sandbox']);

type SiteKind = 'display' | 'gate';

interface AllowlistEntry {
  path: string;
  /** Whitespace-normalised comparison text exactly as the scanner reports it. */
  comparison: string;
  /** Substring of the site's line; required when `comparison` repeats within `path`. */
  context?: string;
  kind: SiteKind;
  rationale: string;
  /** `gate` only: the activity predicate the site must migrate to. */
  followUp?: string;
}

/** Number of `kind: 'gate'` entries accepted as recorded debt. Lower it, never raise it. */
const GATE_DEBT_CEILING = 3;
const GATE_FOLLOW_UP =
  /\bisSessionRunning\b|\bisAgentActivelyWorking\b|\bsessionHasPendingQuestion\b/;
const HOVER_CARD_QUESTION_GATE_FOLLOW_UP =
  'Decide row inclusion from sessionHasPendingQuestion (pending-questions.ts) plus an ' +
  'activity predicate (isSessionRunning / isAgentActivelyWorking); getAgentAttentionRequest ' +
  'only reads attentionRequestKind and does not see pending-question metadata. Keep ladder ' +
  'equality for row copy only.';
const HOVER_CARD_GATE_FOLLOW_UP =
  'Decide row inclusion from getAgentAttentionRequest plus an activity predicate ' +
  '(isSessionRunning / isAgentActivelyWorking); keep ladder equality for row copy only.';

const AGENT_AVATAR_WITH_STATE =
  'src/features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
const AVATAR_STATE_LABEL = 'src/features/agent/components/agent-avatar/avatar-state-label.ts';
const AGENT_CARD = 'src/lib/components/chat/AgentCard.svelte';
const MULTI_SELECT_SIDEBAR = 'src/lib/components/workspace/MultiSelectTabbedSidebar.svelte';
const WORKSPACE_HOVER_CARD = 'src/lib/components/workspace/WorkspaceHoverCard.svelte';
const SIDEBAR_LAUNCHER_PREVIEW = 'src/lib/components/workspace/utils/sidebar-launcher-preview.ts';

const ALLOWLIST: readonly AllowlistEntry[] = [
  {
    path: AGENT_AVATAR_WITH_STATE,
    comparison: "state === 'unread'",
    kind: 'display',
    rationale: 'Renders the unread dot indicator for that one state; nothing is hidden.',
  },
  {
    path: AVATAR_STATE_LABEL,
    comparison: 'switch (state)',
    kind: 'display',
    rationale: 'Exhaustive accessible-label lookup covering every ladder state.',
  },
  {
    path: AGENT_CARD,
    comparison: "avatarState === 'running'",
    kind: 'display',
    rationale: 'Active glow class; the card itself is always rendered.',
  },
  {
    path: AGENT_CARD,
    comparison: "avatarState === 'responding'",
    kind: 'display',
    rationale: 'Active glow class for the declared-but-never-returned responding state.',
  },
  {
    path: AGENT_CARD,
    comparison: "avatarState === 'failed'",
    kind: 'display',
    rationale: 'Red shadow class for the failed state.',
  },
  {
    path: AGENT_CARD,
    comparison: "avatarState === 'needs-permission'",
    kind: 'display',
    rationale: 'Amber shadow class for the needs-permission state.',
  },
  {
    path: AGENT_CARD,
    comparison: "avatarState === 'attention-discussion'",
    kind: 'display',
    rationale: 'Amber shadow class for the attention-discussion state.',
  },
  {
    path: AGENT_CARD,
    comparison: "avatarState === 'attention-blocker'",
    kind: 'display',
    rationale: 'Red shadow class for the attention-blocker state.',
  },
  {
    path: AGENT_CARD,
    comparison: "avatarState === 'waiting'",
    kind: 'display',
    rationale: 'Amber shadow class for the waiting state.',
  },
  {
    path: MULTI_SELECT_SIDEBAR,
    comparison: "state === 'failed'",
    kind: 'display',
    rationale: 'Launcher status tone (danger) for the failed state.',
  },
  {
    path: MULTI_SELECT_SIDEBAR,
    comparison: "state === 'question'",
    kind: 'display',
    rationale: 'Launcher status tone (warning) for user-attention states.',
  },
  {
    path: MULTI_SELECT_SIDEBAR,
    comparison: "state === 'needs-permission'",
    kind: 'display',
    rationale: 'Launcher status tone (warning) for user-attention states.',
  },
  {
    path: MULTI_SELECT_SIDEBAR,
    comparison: "state === 'attention-blocker'",
    kind: 'display',
    rationale: 'Launcher status tone (warning) for user-attention states.',
  },
  {
    path: MULTI_SELECT_SIDEBAR,
    comparison: "state === 'attention-discussion'",
    kind: 'display',
    rationale: 'Launcher status tone (warning) for user-attention states.',
  },
  {
    path: MULTI_SELECT_SIDEBAR,
    comparison: "state === 'running'",
    kind: 'display',
    rationale: 'Launcher status tone (success); launcher membership is decided elsewhere.',
  },
  {
    path: MULTI_SELECT_SIDEBAR,
    comparison: "state === 'responding'",
    kind: 'display',
    rationale: 'Launcher status tone (success) for the declared-but-never-returned state.',
  },
  {
    path: WORKSPACE_HOVER_CARD,
    comparison: "canonicalState === 'question'",
    context: '? sessionPendingQuestions',
    kind: 'display',
    rationale: 'Loads pending-question metadata for the row copy; does not affect inclusion.',
  },
  {
    path: WORKSPACE_HOVER_CARD,
    comparison: "canonicalState === 'question'",
    context: 'if (canonicalState',
    kind: 'gate',
    rationale:
      'Picks the attention row group; without this branch a question session that is neither ' +
      'unread nor active falls through to the final `return null` and is dropped from the card.',
    followUp: HOVER_CARD_QUESTION_GATE_FOLLOW_UP,
  },
  {
    path: WORKSPACE_HOVER_CARD,
    comparison: "canonicalState === 'attention-discussion'",
    kind: 'gate',
    rationale:
      'Picks the attention row group; the branch decides inclusion versus the final `return null`.',
    followUp: HOVER_CARD_GATE_FOLLOW_UP,
  },
  {
    path: WORKSPACE_HOVER_CARD,
    comparison: "canonicalState === 'attention-blocker'",
    kind: 'gate',
    rationale:
      'Picks the attention row group; the branch decides inclusion versus the final `return null`.',
    followUp: HOVER_CARD_GATE_FOLLOW_UP,
  },
  {
    path: SIDEBAR_LAUNCHER_PREVIEW,
    comparison: "state === 'failed'",
    kind: 'display',
    rationale: 'Launcher ordering rank (3) for the failed state.',
  },
  {
    path: SIDEBAR_LAUNCHER_PREVIEW,
    comparison: "state === 'question'",
    kind: 'display',
    rationale: 'Launcher ordering rank (2) for user-attention states.',
  },
  {
    path: SIDEBAR_LAUNCHER_PREVIEW,
    comparison: "state === 'needs-permission'",
    kind: 'display',
    rationale: 'Launcher ordering rank (2) for user-attention states.',
  },
  {
    path: SIDEBAR_LAUNCHER_PREVIEW,
    comparison: "state === 'attention-blocker'",
    kind: 'display',
    rationale: 'Launcher ordering rank (2) for user-attention states.',
  },
  {
    path: SIDEBAR_LAUNCHER_PREVIEW,
    comparison: "state === 'attention-discussion'",
    kind: 'display',
    rationale: 'Launcher ordering rank (2) for user-attention states.',
  },
  {
    path: SIDEBAR_LAUNCHER_PREVIEW,
    comparison: "state === 'running'",
    kind: 'display',
    rationale: 'Launcher ordering rank (1); the running flag is computed separately.',
  },
  {
    path: SIDEBAR_LAUNCHER_PREVIEW,
    comparison: "state === 'responding'",
    kind: 'display',
    rationale: 'Launcher ordering rank (1) for the declared-but-never-returned responding state.',
  },
];

interface ComparisonHit {
  path: string;
  line: number;
  text: string;
  lineText: string;
}

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function productionSourceFiles(directory = 'src'): string[] {
  return readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return EXCLUDED_DIRECTORIES.has(entry.name) || EXCLUDED_DIRECTORIES.has(path)
          ? []
          : productionSourceFiles(path);
      }
      if (!entry.isFile() || path === LADDER_PATH || !isProductionSourceFile(entry.name)) {
        return [];
      }
      return [path];
    },
  );
}

function isProductionSourceFile(name: string): boolean {
  return /\.(?:ts|svelte)$/.test(name) && !EXCLUDED_FILE.test(name);
}

function readAvatarStateLiterals(): string[] {
  const union = source(LADDER_PATH).match(/export type AvatarState =([\s\S]*?);/);
  if (!union) throw new Error(`Could not find the AvatarState union in ${LADDER_PATH}`);
  return [...union[1].matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Index of the `;` or unmatched closer that ends the statement starting at `from`. */
function statementEnd(text: string, from: number): number {
  let depth = 0;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) return index;
      depth -= 1;
    } else if (char === ';' && depth === 0) return index;
  }
  return text.length;
}

/** Index just past the `)` that closes the call whose `(` sits at `open`. */
function callEnd(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (text[cursor] === '\n') line += 1;
  return line;
}

function lineTextAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? text.length : end);
}

function ladderIdentifiers(text: string, ladderOnlyLiteral: string): Set<string> {
  const identifiers = new Set<string>();
  for (const match of text.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::\s*[^=;\n]+?)?=(?!=)/g)) {
    const start = match.index + match[0].length;
    if (LADDER_FUNCTION.test(text.slice(start, statementEnd(text, start)))) {
      identifiers.add(match[1]);
    }
  }
  for (const match of text.matchAll(/\b(\w+)\??\s*:\s*AvatarState\b/g)) identifiers.add(match[1]);
  for (const match of text.matchAll(
    /\b(\w+)\s*:\s*getAvatarState(?:ForSession|FromStore)?\s*\(/g,
  )) {
    identifiers.add(match[1]);
  }
  const ladderOnly = new RegExp(
    `\\b(\\w+)\\s*(?:===|!==)\\s*(?:'|")(?:${ladderOnlyLiteral})(?:'|")|(?:'|")(?:${ladderOnlyLiteral})(?:'|")\\s*(?:===|!==)\\s*\\b(\\w+)\\b`,
    'g',
  );
  for (const match of text.matchAll(ladderOnly)) identifiers.add(match[1] ?? match[2]);
  return identifiers;
}

function ladderReturningFunctions(text: string): string[] {
  return [...text.matchAll(/\bfunction\s+(\w+)\s*\([^)]*\)\s*:\s*AvatarState\b/g)].map(
    (match) => match[1],
  );
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function collectComparisonsIn(path: string, text: string, literals: string[]): ComparisonHit[] {
  const literal = literals.map(escapeRegExp).join('|');
  const ladderOnlyLiteral = LADDER_ONLY_LITERALS.map(escapeRegExp).join('|');
  const hits = new Map<number, ComparisonHit>();
  const record = (index: number, matched: string) => {
    hits.set(index, {
      path,
      line: lineNumberAt(text, index),
      text: normalizeText(matched),
      lineText: lineTextAt(text, index),
    });
  };

  for (const identifier of ladderIdentifiers(text, ladderOnlyLiteral)) {
    const name = escapeRegExp(identifier);
    const forms = [
      `\\b${name}\\b\\s*(?:===|!==)\\s*(?:'|")(?:${literal})(?:'|")`,
      `(?:'|")(?:${literal})(?:'|")\\s*(?:===|!==)\\s*\\b${name}\\b`,
      `\\bswitch\\s*\\(\\s*(?:[\\w$]+\\.)*${name}\\s*\\)`,
    ];
    for (const match of text.matchAll(new RegExp(forms.join('|'), 'g'))) {
      record(match.index, match[0]);
    }
  }

  const callNames = ['getAvatarState(?:ForSession|FromStore)?', ...ladderReturningFunctions(text)];
  for (const callName of callNames) {
    for (const match of text.matchAll(new RegExp(`\\b${callName}\\s*\\(`, 'g'))) {
      const end = callEnd(text, match.index + match[0].length - 1);
      const call = text.slice(match.index, end);
      const tail = text
        .slice(end)
        .match(new RegExp(`^\\s*(?:===|!==)\\s*(?:'|")(?:${literal})(?:'|")`));
      if (tail) record(match.index, call + tail[0]);
      const head = text
        .slice(Math.max(0, match.index - 80), match.index)
        .match(new RegExp(`(?:'|")(?:${literal})(?:'|")\\s*(?:===|!==)\\s*$`));
      if (head) record(match.index - head[0].length, head[0] + call);
    }
  }

  return [...hits.values()].sort((a, b) => a.line - b.line || a.text.localeCompare(b.text));
}

function collectProductionComparisons(): ComparisonHit[] {
  const literals = readAvatarStateLiterals();
  return productionSourceFiles()
    .sort()
    .flatMap((path) => collectComparisonsIn(path, source(path), literals));
}

function matches(entry: AllowlistEntry, hit: ComparisonHit): boolean {
  return (
    entry.path === hit.path &&
    entry.comparison === hit.text &&
    (entry.context === undefined || hit.lineText.includes(entry.context))
  );
}

interface Reconciliation {
  /** Hits no entry claims. */
  unlisted: ComparisonHit[];
  /** Hits more than one entry claims. */
  ambiguous: ComparisonHit[];
  /** Entries matching no hit. */
  stale: AllowlistEntry[];
  /** Entries matching more than one hit. */
  duplicated: { entry: AllowlistEntry; hits: ComparisonHit[] }[];
}

function reconcile(hits: ComparisonHit[], allowlist: readonly AllowlistEntry[]): Reconciliation {
  const result: Reconciliation = { unlisted: [], ambiguous: [], stale: [], duplicated: [] };
  for (const hit of hits) {
    const owners = allowlist.filter((entry) => matches(entry, hit));
    if (owners.length === 0) result.unlisted.push(hit);
    else if (owners.length > 1) result.ambiguous.push(hit);
  }
  for (const entry of allowlist) {
    const covered = hits.filter((hit) => matches(entry, hit));
    if (covered.length === 0) result.stale.push(entry);
    else if (covered.length > 1) result.duplicated.push({ entry, hits: covered });
  }
  return result;
}

function describeHit(hit: ComparisonHit): string {
  return `${hit.path}:${hit.line} — ${hit.text}`;
}

function describeEntry(entry: AllowlistEntry): string {
  return `${entry.path}#${entry.comparison}${entry.context ? ` @ ${entry.context}` : ''}`;
}

function describeDuplicate({ entry, hits }: Reconciliation['duplicated'][number]): string {
  return `${describeEntry(entry)} covers one site but matched ${hits.length}:\n  ${hits
    .map(describeHit)
    .join('\n  ')}`;
}

const GUIDANCE =
  `Visibility gates must use isSessionRunning / isAgentActivelyWorking from ${LADDER_PATH}; ` +
  `display mappings need their own allowlist entry with a rationale in ${INVENTORY_PATH}.`;

describe('avatar-state comparison inventory', () => {
  it('reads the ladder literals from the ladder module', () => {
    const literals = readAvatarStateLiterals();
    expect(literals).toContain('running');
    for (const literal of LADDER_ONLY_LITERALS) expect(literals).toContain(literal);
  });

  it('keeps every production comparison against a ladder literal on the audited allowlist', () => {
    const hits = collectProductionComparisons();
    expect(hits.length).toBeGreaterThan(0);
    const { unlisted, ambiguous, duplicated } = reconcile(hits, ALLOWLIST);
    expect(
      unlisted.map(describeHit),
      `Unaudited comparison of an AvatarState ladder result to a literal:\n` +
        `${unlisted.map(describeHit).join('\n')}\n${GUIDANCE}`,
    ).toEqual([]);
    expect(
      duplicated.map(describeDuplicate),
      `An allowlist entry covers exactly one site; add an entry (with context) per site in ` +
        `${INVENTORY_PATH}:\n${duplicated.map(describeDuplicate).join('\n')}\n${GUIDANCE}`,
    ).toEqual([]);
    expect(
      ambiguous.map(describeHit),
      `Comparison claimed by more than one allowlist entry; tighten context in ${INVENTORY_PATH}:\n` +
        ambiguous.map(describeHit).join('\n'),
    ).toEqual([]);
  });

  it('keeps every allowlist entry resolving to exactly one comparison site', () => {
    const { stale } = reconcile(collectProductionComparisons(), ALLOWLIST);
    expect(
      stale.map(describeEntry),
      `Stale allowlist entries in ${INVENTORY_PATH} (no matching comparison in production source):\n` +
        stale.map(describeEntry).join('\n'),
    ).toEqual([]);
    expect(new Set(ALLOWLIST.map(describeEntry)).size).toBe(ALLOWLIST.length);
  });

  it('records a rationale for every entry and ratchets ladder-equality gate debt', () => {
    for (const entry of ALLOWLIST)
      expect(entry.rationale.trim(), describeEntry(entry)).not.toBe('');
    const gates = ALLOWLIST.filter((entry) => entry.kind === 'gate');
    for (const gate of gates) {
      expect(
        gate.followUp ?? '',
        `${describeEntry(gate)} is a gate and must name the predicate to migrate to ` +
          `(isSessionRunning / isAgentActivelyWorking / sessionHasPendingQuestion)`,
      ).toMatch(GATE_FOLLOW_UP);
    }
    expect(
      gates.length,
      `Gate entries compare a ladder result to decide visibility/inclusion. Do not add new ones; ` +
        `migrate the recorded debt to isSessionRunning / isAgentActivelyWorking (${LADDER_PATH}) ` +
        `or sessionHasPendingQuestion (pending-questions.ts) ` +
        `and lower GATE_DEBT_CEILING:\n${gates.map(describeEntry).join('\n')}`,
    ).toBeLessThanOrEqual(GATE_DEBT_CEILING);
  });

  describe('regression fixtures (in-memory edits of real production source)', () => {
    const literals = readAvatarStateLiterals();
    const GLOW_LINE = "if (avatarState === 'running' || avatarState === 'responding')";
    const FAILED_GLOW_LINE =
      "if (avatarState === 'failed') return 'shadow shadow-red-500 shadow-sm';";
    const MENTION_AVATAR = 'src/lib/components/chat/input/MentionAgentAvatar.svelte';

    function reconcileFixture(path: string, text: string): Reconciliation {
      return reconcile(collectComparisonsIn(path, text, literals), ALLOWLIST);
    }

    function agentCardSource(): string {
      const text = source(AGENT_CARD);
      expect(text).toContain(GLOW_LINE);
      expect(text).toContain(FAILED_GLOW_LINE);
      return text;
    }

    it('fails a duplicate ladder-equality gate added elsewhere in an allowlisted file', () => {
      const comparison = "avatarState === 'running'";
      const injectedLine = `if (${comparison}) return;`;
      const text = agentCardSource().replace('</script>', `  ${injectedLine}\n</script>`);
      const { unlisted, duplicated } = reconcileFixture(AGENT_CARD, text);
      expect(unlisted).toEqual([]);
      const duplicate = duplicated.find(({ entry }) => entry.comparison === comparison);
      expect(duplicate?.hits.map((hit) => hit.lineText.trim())).toEqual(
        expect.arrayContaining([expect.stringContaining(GLOW_LINE), injectedLine]),
      );
      expect(duplicate?.hits).toHaveLength(2);
      expect(duplicated.map(describeDuplicate).join('\n')).toMatch(
        new RegExp(`${escapeRegExp(AGENT_CARD)}:\\d+ — ${escapeRegExp(comparison)}`),
      );
    });

    it('fails an extra comparison added to an already-allowlisted line', () => {
      const text = agentCardSource().replace(
        GLOW_LINE,
        "if (avatarState === 'running' || avatarState === 'responding' || avatarState === 'waiting')",
      );
      const { duplicated } = reconcileFixture(AGENT_CARD, text);
      const duplicate = duplicated.find(
        ({ entry }) => entry.comparison === "avatarState === 'waiting'",
      );
      expect(duplicate?.hits).toHaveLength(2);
      expect(new Set(duplicate?.hits.map((hit) => hit.line)).size).toBe(2);
    });

    it('fails a direct visibility gate injected into a non-allowlisted component', () => {
      const text = source(MENTION_AVATAR).replace(
        '</script>',
        "  if (getAvatarStateForSession(session) !== 'running') return;\n</script>",
      );
      const { unlisted } = reconcileFixture(MENTION_AVATAR, text);
      expect(unlisted.map((hit) => hit.text)).toEqual([
        "getAvatarStateForSession(session) !== 'running'",
      ]);
      expect(unlisted.map(describeHit).join('\n')).toMatch(
        new RegExp(`^${escapeRegExp(MENTION_AVATAR)}:\\d+ — `),
      );
    });

    it('fails a literal-first direct visibility gate injected into a non-allowlisted component', () => {
      const comparison = "'running' !== getAvatarStateForSession(session)";
      const text = source(MENTION_AVATAR).replace(
        '</script>',
        `  if (${comparison}) return;\n</script>`,
      );
      const { unlisted } = reconcileFixture(MENTION_AVATAR, text);
      expect(unlisted.map((hit) => hit.text)).toEqual([comparison]);
    });

    it('ignores comparisons in .test / .spec / .stories files of any extension', () => {
      const comparison = "getAvatarStateForSession(session) !== 'running'";
      const body = `<script lang="ts">\n  if (${comparison}) throw new Error();\n</script>`;
      const directory = 'src/lib/components/chat';
      const names = [
        'Strip.test.svelte',
        'Strip.spec.svelte',
        'Strip.stories.svelte',
        'Strip.svelte',
      ];
      const hits = names
        .map((name) => `${directory}/${name}`)
        .filter((path) => isProductionSourceFile(basename(path)))
        .flatMap((path) => collectComparisonsIn(path, body, literals));
      expect(hits.map((hit) => `${hit.path} — ${hit.text}`)).toEqual([
        `${directory}/Strip.svelte — ${comparison}`,
      ]);
    });

    it('reports a stale entry when an allowlisted comparison is removed', () => {
      const text = agentCardSource().replace(FAILED_GLOW_LINE, '');
      const { stale } = reconcileFixture(AGENT_CARD, text);
      expect(stale.filter((entry) => entry.path === AGENT_CARD).map(describeEntry)).toEqual([
        `${AGENT_CARD}#avatarState === 'failed'`,
      ]);
    });
  });
});
