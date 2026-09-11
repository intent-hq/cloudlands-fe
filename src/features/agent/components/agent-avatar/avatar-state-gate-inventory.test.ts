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
// `ALLOWLIST` with a one-line rationale. Every comparison site in production
// source must be allowlisted, and a `gate` entry is refused: it is migration
// debt that must move to an activity predicate in a follow-up.
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
//    `<fn returning AvatarState>(…)` call compared to a literal.
//  - Limits: cross-file flow through `string`/untyped parameters is caught only
//    by the ladder-only-literal rule; destructured bindings, `.includes(…)`,
//    `Set.has(…)`, lookup tables, and comparisons against a variable holding a
//    literal are not detected.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LADDER_PATH = 'src/features/agent/components/agent-avatar/avatar-state.ts';
const INVENTORY_PATH =
  'src/features/agent/components/agent-avatar/avatar-state-gate-inventory.test.ts';
const LADDER_FUNCTION = /\bgetAvatarState(?:ForSession|FromStore)?\b/;
const LADDER_ONLY_LITERALS = ['needs-permission', 'attention-discussion', 'attention-blocker'];
const EXCLUDED_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|\.stories\./;
const EXCLUDED_DIRECTORIES = new Set(['__tests__', 'src/routes/sandbox']);

type SiteKind = 'display' | 'gate';

interface AllowlistEntry {
  /** `<path>#<anchor>` — the anchor must appear on every covered comparison line. */
  site: `${string}#${string}`;
  kind: SiteKind;
  rationale: string;
}

const ALLOWLIST: readonly AllowlistEntry[] = [
  {
    site: "src/features/agent/components/agent-avatar/AgentAvatarWithState.svelte#state === 'unread'",
    kind: 'display',
    rationale: 'Renders the unread dot indicator for that one state; nothing is hidden.',
  },
  {
    site: 'src/features/agent/components/agent-avatar/avatar-state-label.ts#switch (state)',
    kind: 'display',
    rationale: 'Exhaustive accessible-label lookup covering every ladder state.',
  },
  {
    site: "src/lib/components/chat/AgentCard.svelte#avatarState === 'running'",
    kind: 'display',
    rationale: 'Glow class for live states; the card itself is always rendered.',
  },
  {
    site: "src/lib/components/chat/AgentCard.svelte#avatarState === 'failed'",
    kind: 'display',
    rationale: 'Red shadow class for the failed state.',
  },
  {
    site: "src/lib/components/chat/AgentCard.svelte#avatarState === 'needs-permission'",
    kind: 'display',
    rationale: 'Amber shadow class for the needs-permission state.',
  },
  {
    site: "src/lib/components/chat/AgentCard.svelte#avatarState === 'attention-discussion'",
    kind: 'display',
    rationale: 'Amber shadow class for the attention-discussion state.',
  },
  {
    site: "src/lib/components/chat/AgentCard.svelte#avatarState === 'attention-blocker'",
    kind: 'display',
    rationale: 'Red shadow class for the attention-blocker state.',
  },
  {
    site: "src/lib/components/chat/AgentCard.svelte#avatarState === 'waiting'",
    kind: 'display',
    rationale: 'Amber shadow class for the waiting state.',
  },
  {
    site: "src/lib/components/workspace/MultiSelectTabbedSidebar.svelte#state === 'failed'",
    kind: 'display',
    rationale: 'Launcher status tone (danger) for the failed state.',
  },
  {
    site: "src/lib/components/workspace/MultiSelectTabbedSidebar.svelte#state === 'question'",
    kind: 'display',
    rationale: 'Launcher status tone (warning) for user-attention states.',
  },
  {
    site: "src/lib/components/workspace/MultiSelectTabbedSidebar.svelte#state === 'needs-permission'",
    kind: 'display',
    rationale: 'Launcher status tone (warning) for user-attention states.',
  },
  {
    site: "src/lib/components/workspace/MultiSelectTabbedSidebar.svelte#state === 'attention-blocker'",
    kind: 'display',
    rationale: 'Launcher status tone (warning) for user-attention states.',
  },
  {
    site: "src/lib/components/workspace/MultiSelectTabbedSidebar.svelte#state === 'attention-discussion'",
    kind: 'display',
    rationale: 'Launcher status tone (warning) for user-attention states.',
  },
  {
    site: "src/lib/components/workspace/MultiSelectTabbedSidebar.svelte#state === 'running'",
    kind: 'display',
    rationale: 'Launcher status tone (success) for live states; membership is decided elsewhere.',
  },
  {
    site: "src/lib/components/workspace/WorkspaceHoverCard.svelte#canonicalState === 'question'",
    kind: 'display',
    rationale: 'Selects the question row copy/meta; the row is emitted for every state.',
  },
  {
    site: "src/lib/components/workspace/WorkspaceHoverCard.svelte#canonicalState === 'attention-discussion'",
    kind: 'display',
    rationale: 'Selects the discussion row copy; the row is emitted for every state.',
  },
  {
    site: "src/lib/components/workspace/WorkspaceHoverCard.svelte#canonicalState === 'attention-blocker'",
    kind: 'display',
    rationale: 'Selects the blocker row copy; the row is emitted for every state.',
  },
  {
    site: "src/lib/components/workspace/utils/sidebar-launcher-preview.ts#state === 'failed'",
    kind: 'display',
    rationale: 'Launcher ordering rank (3) for the failed state.',
  },
  {
    site: "src/lib/components/workspace/utils/sidebar-launcher-preview.ts#state === 'question'",
    kind: 'display',
    rationale: 'Launcher ordering rank (2) for user-attention states.',
  },
  {
    site: "src/lib/components/workspace/utils/sidebar-launcher-preview.ts#state === 'needs-permission'",
    kind: 'display',
    rationale: 'Launcher ordering rank (2) for user-attention states.',
  },
  {
    site: "src/lib/components/workspace/utils/sidebar-launcher-preview.ts#state === 'attention-blocker'",
    kind: 'display',
    rationale: 'Launcher ordering rank (2) for user-attention states.',
  },
  {
    site: "src/lib/components/workspace/utils/sidebar-launcher-preview.ts#state === 'attention-discussion'",
    kind: 'display',
    rationale: 'Launcher ordering rank (2) for user-attention states.',
  },
  {
    site: "src/lib/components/workspace/utils/sidebar-launcher-preview.ts#state === 'running'",
    kind: 'display',
    rationale:
      'Launcher ordering rank (1) for live states; the running flag is computed separately.',
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
      if (!entry.isFile() || path === LADDER_PATH || EXCLUDED_FILE.test(entry.name)) return [];
      return /\.(?:ts|svelte)$/.test(entry.name) ? [path] : [];
    },
  );
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

function collectComparisons(path: string, literals: string[]): ComparisonHit[] {
  const text = source(path);
  const literal = literals.map(escapeRegExp).join('|');
  const ladderOnlyLiteral = LADDER_ONLY_LITERALS.map(escapeRegExp).join('|');
  const hits = new Map<string, ComparisonHit>();
  const record = (index: number, matched: string) => {
    const hit = {
      path,
      line: lineNumberAt(text, index),
      text: normalizeText(matched),
      lineText: lineTextAt(text, index),
    };
    hits.set(`${hit.line}:${hit.text}`, hit);
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
      const tail = text
        .slice(end)
        .match(new RegExp(`^\\s*(?:===|!==)\\s*(?:'|")(?:${literal})(?:'|")`));
      if (tail) record(match.index, text.slice(match.index, end) + tail[0]);
    }
  }

  return [...hits.values()].sort((a, b) => a.line - b.line || a.text.localeCompare(b.text));
}

function collectProductionComparisons(): ComparisonHit[] {
  const literals = readAvatarStateLiterals();
  return productionSourceFiles()
    .sort()
    .flatMap((path) => collectComparisons(path, literals));
}

function splitSite(site: string): { path: string; anchor: string } {
  const separator = site.indexOf('#');
  return { path: site.slice(0, separator), anchor: site.slice(separator + 1) };
}

function covers(entry: AllowlistEntry, hit: ComparisonHit): boolean {
  const { path, anchor } = splitSite(entry.site);
  return path === hit.path && (hit.lineText.includes(anchor) || hit.text.includes(anchor));
}

function describeHit(hit: ComparisonHit): string {
  return `${hit.path}:${hit.line} — ${hit.text}`;
}

const GUIDANCE =
  `Visibility gates must use isSessionRunning / isAgentActivelyWorking from ${LADDER_PATH}; ` +
  `display mappings need an allowlist entry with a rationale in ${INVENTORY_PATH}.`;

describe('avatar-state comparison inventory', () => {
  it('reads the ladder literals from the ladder module', () => {
    const literals = readAvatarStateLiterals();
    expect(literals).toContain('running');
    for (const literal of LADDER_ONLY_LITERALS) expect(literals).toContain(literal);
  });

  it('keeps every production comparison against a ladder literal on the audited allowlist', () => {
    const hits = collectProductionComparisons();
    expect(hits.length).toBeGreaterThan(0);
    const unlisted = hits.filter((hit) => !ALLOWLIST.some((entry) => covers(entry, hit)));
    expect(
      unlisted.map(describeHit),
      `Unaudited comparison of an AvatarState ladder result to a literal:\n` +
        `${unlisted.map(describeHit).join('\n')}\n${GUIDANCE}`,
    ).toEqual([]);
  });

  it('keeps every allowlist entry resolving to at least one comparison site', () => {
    const hits = collectProductionComparisons();
    const stale = ALLOWLIST.filter((entry) => !hits.some((hit) => covers(entry, hit)));
    expect(
      stale.map((entry) => entry.site),
      `Stale allowlist entries in ${INVENTORY_PATH} (no matching comparison in production source):\n` +
        stale.map((entry) => entry.site).join('\n'),
    ).toEqual([]);
    expect(new Set(ALLOWLIST.map((entry) => entry.site)).size).toBe(ALLOWLIST.length);
  });

  it('records a rationale for every entry and no visibility gate on ladder equality', () => {
    for (const entry of ALLOWLIST) expect(entry.rationale.trim(), entry.site).not.toBe('');
    const gates = ALLOWLIST.filter((entry) => entry.kind === 'gate').map((entry) => entry.site);
    expect(
      gates,
      `Gate entries compare a ladder result to decide visibility/inclusion; migrate them to ` +
        `isSessionRunning / isAgentActivelyWorking (${LADDER_PATH}):\n${gates.join('\n')}`,
    ).toEqual([]);
  });
});
