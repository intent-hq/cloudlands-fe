import type { DockMediaTranscript } from '$shared/dock-media-edit';

type Word = DockMediaTranscript['words'][number];

export function transcriptText(words: readonly Word[], edits: Readonly<Record<string, string>>): string {
  return words.map((word) => edits[word.id] ?? word.text).filter(Boolean).join(' ');
}

/**
 * Corrections keep the recognizer's identities and timings. A replacement spanning
 * several units belongs to the first touched unit; the others become empty text.
 * Annotation boundaries split runs, so editing cannot move an annotation's anchor.
 */
export function transcriptTextChange(
  words: readonly Word[],
  edits: Readonly<Record<string, string>>,
  next: string,
): Record<string, string | null> {
  const before = transcriptText(words, edits);
  if (before === next || !words.length) return {};
  if (next === transcriptText(words, {}))
    return Object.fromEntries(words.map((word) => [word.id, null]));
  let prefix = 0;
  while (prefix < before.length && prefix < next.length && before[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < next.length - prefix &&
    before[before.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  let offset = 0;
  const units = words.flatMap((word) => {
    const value = edits[word.id] ?? word.text;
    // Deleted units have no visible character to own a later correction.
    if (!value) return [];
    const start = offset;
    offset += value.length + 1;
    return [{ word, start, end: offset - 1 }];
  });
  if (!units.length)
    return next.length <= 20_000 ? { [words[0].id]: next || null } : {};
  const changedEnd = before.length - suffix;
  const insertion = changedEnd === prefix;
  let first = units.findIndex((unit) => unit.end > prefix);
  if (first < 0) first = units.length - 1;
  // A changed separator joins its adjacent units. An insertion at a word's end
  // still belongs to that visible word, rather than the next recognition unit.
  if (first > 0 && units[first - 1].end === prefix) first--;
  let last = insertion ? first : units.findLastIndex((unit) => unit.start < changedEnd);
  last = Math.max(first, last);
  const leading = () => units.slice(0, first).map(({ word }) => edits[word.id] ?? word.text).join(' ');
  const trailing = () => units.slice(last + 1).map(({ word }) => edits[word.id] ?? word.text).join(' ');
  // Keep complete, untouched units outside the changed range. Their separator is
  // supplied by transcriptText, including when the first/last unit was deleted.
  while (first > 0 && !next.startsWith(leading() + ' ')) first--;
  while (last < units.length - 1 && !next.endsWith(' ' + trailing()) && next !== trailing()) last++;
  const left = leading();
  const right = trailing();
  const withoutTouched = [left, right].filter(Boolean).join(' ');
  const replacement = next === withoutTouched ? '' : next.slice(left ? left.length + 1 : 0, right ? -(right.length + 1) : undefined);
  if (replacement.length > 20_000) return {};
  return Object.fromEntries(units.slice(first, last + 1).map(({ word }, index) => {
    const value = index === 0 ? replacement : '';
    return [word.id, value === word.text ? null : value];
  }));
}
