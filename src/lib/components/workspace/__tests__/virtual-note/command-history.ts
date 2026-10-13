import type { Transaction } from '@tiptap/pm/state';
export type CommandHistory = { before: [number, number][]; after: [number, number][] };
/** Native root change ranges, with appended repairs mapped onto the final document. */
export function commandHistory(transactions: readonly Transaction[]): CommandHistory {
  const root = transactions[0];
  const before: [number, number][] = [],
    after: [number, number][] = [];
  root?.mapping.maps[0]?.forEach((from, to) => before.push([from, to]));
  for (let i = (root?.mapping.maps.length ?? 0) - 1; i >= 0 && !after.length; i--) {
    root.mapping.maps[i].forEach((_a, _b, from, to) => {
      from = root.mapping.slice(i + 1).map(from, 1);
      to = root.mapping.slice(i + 1).map(to, -1);
      for (const appended of transactions.slice(1)) {
        from = appended.mapping.map(from, 1);
        to = appended.mapping.map(to, -1);
      }
      if (from <= to) after.push([from, to]);
    });
  }
  return { before, after };
}
