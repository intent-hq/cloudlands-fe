/**
 * Client view of `agent.getSession`'s `promptBreakdown` (docs/protocol/methods/agents.md
 * "Prompt breakdown"): what Intent put into an agent's starting context, by section.
 * `null` means "show nothing": an older daemon, an unavailable arm, or a malformed value.
 * Rows that do not match the contract are left out rather than repaired.
 */

export type PromptOwner = 'intent' | 'user';

const PROMPT_OWNERS: readonly PromptOwner[] = ['intent', 'user'];
const LOCATIONS = ['systemPrompt', 'toolDescription', 'provider'];

interface PromptBreakdownRow {
  key: string;
  id: string;
  label: string;
  owner: PromptOwner;
  chars: number;
  estTokens: number;
  /** False for text the provider loads itself: it is not part of the total. */
  counted: boolean;
  hint?: string;
}

interface PromptOwnerSummary {
  owner: PromptOwner;
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
const isOwner = (value: unknown): value is PromptOwner => value === 'intent' || value === 'user';

function parseRow(value: unknown, index: number): PromptBreakdownRow | null {
  if (!isObject(value)) return null;
  const { id, label, owner, location, chars, estTokens, controlHint } = value;
  if (typeof id !== 'string' || typeof label !== 'string' || !isOwner(owner)) return null;
  if (typeof location !== 'string' || !LOCATIONS.includes(location)) return null;
  if (!isCount(chars) || !isCount(estTokens)) return null;
  const hint = isObject(controlHint) && typeof controlHint.text === 'string' && controlHint.text;
  return {
    key: `${index}:${id}`,
    id,
    label,
    owner,
    chars,
    estTokens,
    counted: location !== 'provider',
    ...(hint ? { hint } : {}),
  };
}

function parseHiddenSkill(value: unknown): PromptHiddenSkill | null {
  if (!isObject(value)) return null;
  const { name, reason, detail, fix } = value;
  if ([name, reason, detail, fix].some((field) => typeof field !== 'string')) return null;
  return { name, reason, detail, fix } as PromptHiddenSkill;
}

export function parsePromptBreakdown(value: unknown): PromptBreakdownView | null {
  if (!isObject(value) || value.available !== true) return null;
  const { totalChars, estTokens, sections, hiddenSkills } = value;
  if (!isCount(totalChars) || !isCount(estTokens) || !Array.isArray(sections)) return null;
  if (!Array.isArray(hiddenSkills)) return null;

  const rows = sections
    .map(parseRow)
    .filter((row) => row !== null)
    .sort((a, b) => b.chars - a.chars);

  const owners = PROMPT_OWNERS.map((owner) => {
    const counted = rows.filter((row) => row.counted && row.owner === owner);
    const chars = counted.reduce((sum, row) => sum + row.chars, 0);
    return {
      owner,
      chars,
      estTokens: counted.reduce((sum, row) => sum + row.estTokens, 0),
      share: totalChars > 0 ? chars / totalChars : 0,
    };
  }).filter((summary) => summary.chars > 0);

  return {
    totalChars,
    estTokens,
    rows,
    owners,
    hiddenSkills: hiddenSkills.map(parseHiddenSkill).filter((skill) => skill !== null),
  };
}

/**
 * Whether a session stamped `version` can carry a breakdown, so other agents skip the
 * (up to ~480 KB) `agent.getSession` read. Released 3.11 records none. Later or unparsable
 * versions are read so the daemon decides.
 */
export function harnessMayRecordPromptBreakdown(version: string | null | undefined): boolean {
  if (!version) return false;
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (!match) return true;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major === 3 && minor === 11) return false;
  return major > 3 || (major === 3 && minor >= 10);
}
