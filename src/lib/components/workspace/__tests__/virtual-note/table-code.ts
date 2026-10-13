import { diffChars } from 'diff';
import { tableRuns } from './table-source';
import type { Splice } from './source-journal';

export type TableCodeEdit = {
  from: number;
  to: number;
  insert: string;
  code: { from: number; to: number };
};
/** Backing-owned encoding and diff. Only bounded syntax patches cross into the view. */
export function tableCodeChanges(raw: string, edit: TableCodeEdit): Splice[] {
  const runs = tableRuns(raw, edit.code.from);
  const offset = (point: number) => {
    let count = 0;
    for (const run of runs) {
      if (point >= run.to) {
        count += run.text.length;
        continue;
      }
      if (point <= run.from) return count;
      return count + (run.to - run.from === run.text.length ? point - run.from : 0);
    }
    return count;
  };
  const value = runs.map((r) => r.text).join('');
  const next = value.slice(0, offset(edit.from)) + edit.insert + value.slice(offset(edit.to));
  const minimum = raw.match(/^`+/)?.[0].length ?? 1;
  const encoded = next
    .split(/(?<=\\)(?=\|)/)
    .map((part) => {
      let longest = 0;
      for (const run of part.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
      const fence = '`'.repeat(Math.max(minimum, longest + 1));
      const pad = /^`|`$/.test(part) || (/^ .* $/.test(part) && /[^ ]/.test(part));
      return `${fence}${pad ? ' ' : ''}${part}${pad ? ' ' : ''}${fence}`;
    })
    .join('<!-- -->')
    .replace(/\|/g, '\\|');
  const diff = diffChars(raw, encoded, { maxEditLength: 1024 });
  if (!diff) throw new Error('Code edit exceeds bounded patch admission');
  const splices: Splice[] = [];
  let position = edit.code.from;
  for (const part of diff) {
    if (part.added) splices.push({ from: position, to: position, insert: part.value });
    else if (part.removed) {
      splices.push({ from: position, to: position + part.value.length, insert: '' });
      position += part.value.length;
    } else position += part.value.length;
  }
  return splices.reverse();
}
