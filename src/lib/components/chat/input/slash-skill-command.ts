import type { SkillInfo } from '$store/renderer/slices/skills/skills-types';

export type SlashCommandContext = {
  query: string;
  from: number;
  to: number;
};

export type SlashSkillSelection = {
  text: string;
  cursorOffset: number;
};

const WHITESPACE = /\s/u;

/**
 * Find the slash-command token immediately before the cursor.
 *
 * The slash must start at a token boundary and the cursor must be inside that
 * token, so URL/path slashes and completed commands elsewhere stay inactive.
 */
export function findSlashCommandContext(
  prompt: string,
  cursorOffset = prompt.length,
): SlashCommandContext | null {
  if (cursorOffset < 0 || cursorOffset > prompt.length) return null;

  let from = cursorOffset - 1;
  while (from >= 0 && !WHITESPACE.test(prompt[from])) from -= 1;
  from += 1;

  if (prompt[from] !== '/' || cursorOffset < from + 1) return null;

  let to = from + 1;
  while (to < prompt.length && !WHITESPACE.test(prompt[to])) to += 1;

  if (cursorOffset > to) return null;

  return {
    query: prompt.slice(from + 1, cursorOffset),
    from,
    to,
  };
}

function matchRank(skill: SkillInfo, normalizedQuery: string): number | null {
  if (!normalizedQuery) return 0;

  const name = skill.name.toLowerCase();
  const description = skill.description.toLowerCase();

  if (name === normalizedQuery) return 0;
  if (name.startsWith(normalizedQuery)) return 1;
  if (name.includes(normalizedQuery)) return 2;
  if (description.includes(normalizedQuery)) return 3;
  return null;
}

function compareText(left: string, right: string): number {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Filter and rank available skills without mutating the workspace roster. */
export function rankSlashSkills(skills: readonly SkillInfo[], query: string): SkillInfo[] {
  const normalizedQuery = query.toLowerCase();

  return skills
    .map((skill) => ({ skill, rank: matchRank(skill, normalizedQuery) }))
    .filter((entry): entry is { skill: SkillInfo; rank: number } => entry.rank !== null)
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        compareText(left.skill.name, right.skill.name) ||
        compareText(left.skill.location, right.skill.location) ||
        compareText(left.skill.description, right.skill.description),
    )
    .map(({ skill }) => skill);
}

/** Replace the active slash token while preserving the rest of the prompt. */
export function applySlashSkillSelection(
  prompt: string,
  context: SlashCommandContext,
  skill: Pick<SkillInfo, 'name'>,
): SlashSkillSelection {
  const command = `/${skill.name}`;
  const suffix = prompt.slice(context.to);
  const needsSpace = suffix.length === 0 || !WHITESPACE.test(suffix[0]);
  const separator = needsSpace ? ' ' : '';

  return {
    text: `${prompt.slice(0, context.from)}${command}${separator}${suffix}`,
    cursorOffset: context.from + command.length + 1,
  };
}
