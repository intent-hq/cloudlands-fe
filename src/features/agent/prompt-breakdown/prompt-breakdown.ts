/**
 * Client view of `agent.getSession`'s `promptBreakdown` (docs/protocol/methods/agents.md
 * "Prompt breakdown"): what Intent put into an agent's starting context, by section.
 * `null` means "show nothing": an older daemon, an unavailable arm, or a malformed value.
 */

export type PromptOwnerGroup = 'intent' | 'repo' | 'user';

const PROMPT_OWNER_GROUPS: readonly PromptOwnerGroup[] = ['intent', 'repo', 'user'];

interface PromptBreakdownRow {
  key: string;
  id: string;
  label: string;
  group: PromptOwnerGroup;
  chars: number;
  estTokens: number;
  /** False for text the provider loads itself: it is not part of the total. */
  counted: boolean;
  hint?: string;
}

interface PromptOwnerSummary {
  group: PromptOwnerGroup;
  chars: number;
  estTokens: number;
  share: number;
}

interface PromptHiddenSkill {
  name: string;
  reason: string;
  detail: string;
  fix: string;
}

export interface PromptBreakdownView {
  harnessVersion: string;
  recordedAt: string;
  totalChars: number;
  estTokens: number;
  rows: PromptBreakdownRow[];
  owners: PromptOwnerSummary[];
  hiddenSkills: PromptHiddenSkill[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const estimate = (chars: number) => Math.ceil(chars / 4);

function ownerGroup(id: string, owner: unknown): PromptOwnerGroup {
  if (owner === 'intent') return 'intent';
  if (owner === 'repo' || id.startsWith('repo-')) return 'repo';
  return 'user';
}

function parseRow(value: unknown, index: number): PromptBreakdownRow | null {
  if (!isObject(value)) return null;
  const { id, label, owner, location, chars, estTokens, controlHint } = value;
  if (typeof id !== 'string' || typeof label !== 'string' || !isCount(chars)) return null;
  const hint =
    isObject(controlHint) && typeof controlHint.text === 'string' ? controlHint.text : '';
  return {
    key: `${index}:${id}`,
    id,
    label,
    group: ownerGroup(id, owner),
    chars,
    estTokens: isCount(estTokens) ? estTokens : estimate(chars),
    counted: location === 'systemPrompt' || location === 'toolDescription',
    ...(hint ? { hint } : {}),
  };
}

function parseHiddenSkill(value: unknown): PromptHiddenSkill | null {
  if (!isObject(value)) return null;
  const { name, reason, detail, fix } = value;
  if (typeof name !== 'string') return null;
  return {
    name,
    reason: typeof reason === 'string' ? reason : '',
    detail: typeof detail === 'string' ? detail : '',
    fix: typeof fix === 'string' ? fix : '',
  };
}

export function parsePromptBreakdown(value: unknown): PromptBreakdownView | null {
  if (!isObject(value) || value.available !== true) return null;
  const { totalChars, estTokens, sections, hiddenSkills } = value;
  if (!isCount(totalChars) || !Array.isArray(sections)) return null;

  const rows = sections
    .map(parseRow)
    .filter((row): row is PromptBreakdownRow => row !== null)
    .sort((a, b) => b.chars - a.chars);

  const owners = PROMPT_OWNER_GROUPS.map((group) => {
    const chars = rows
      .filter((row) => row.counted && row.group === group)
      .reduce((sum, row) => sum + row.chars, 0);
    return {
      group,
      chars,
      estTokens: estimate(chars),
      share: totalChars > 0 ? chars / totalChars : 0,
    };
  }).filter((owner) => owner.chars > 0);

  return {
    harnessVersion: typeof value.harnessVersion === 'string' ? value.harnessVersion : '',
    recordedAt: typeof value.recordedAt === 'string' ? value.recordedAt : '',
    totalChars,
    estTokens: isCount(estTokens) ? estTokens : estimate(totalChars),
    rows,
    owners,
    hiddenSkills: Array.isArray(hiddenSkills)
      ? hiddenSkills.map(parseHiddenSkill).filter((skill) => skill !== null)
      : [],
  };
}

/**
 * Whether a session stamped `version` can carry a breakdown, so older agents skip the
 * (up to ~480 KB) `agent.getSession` read. Versions it cannot parse are read: the daemon decides.
 */
export function harnessMayRecordPromptBreakdown(version: string | null | undefined): boolean {
  if (!version) return false;
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (!match) return true;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 3 || (major === 3 && minor >= 10);
}
