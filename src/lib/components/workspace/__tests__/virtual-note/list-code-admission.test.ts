import { expect, it } from 'vitest';
import { SourceJournal } from './source-journal';
const source = '- first\n- second`body`\n\nplain`other`';
const from = source.indexOf('`'),
  bodyFrom = from + 1,
  bodyTo = bodyFrom + 4;
const code = {
  item: source.indexOf('- second'),
  from,
  bodyFrom,
  bodyTo,
  to: bodyTo + 1,
  language: 'text',
};
for (const [label, records] of [
  ['unrelated preceding item', [{ ...code, item: 0 }]],
  ['non-item owner', [{ ...code, item: code.item + 2 }]],
  [
    'plain prose body',
    [
      {
        ...code,
        from: source.lastIndexOf('`') - 6,
        bodyFrom: source.lastIndexOf('`') - 5,
        bodyTo: source.lastIndexOf('`'),
        to: source.lastIndexOf('`') + 1,
      },
    ],
  ],
  ['conflicting duplicate', [code, { ...code, language: 'rust' }]],
] as const) {
  it(`rejects nested code metadata with ${label} atomically`, () => {
    const backing = new SourceJournal(() => source, 1);
    const revision = backing.revision,
      context = backing.inlineContext(0, source.length);
    expect(() => backing.setListCodes(0, source.length, [...records])).toThrow('Invalid');
    expect(backing.revision).toBe(revision);
    expect(backing.region(0)).toBe(source);
    expect(backing.inlineContext(0, source.length)).toEqual(context);
  });
}
it('preserves owned code through unrelated remote edits without retained history', () => {
  const backing = new SourceJournal(() => source, 1);
  backing.setListCodes(0, source.length, [code], backing.revision, false);
  backing.stage({ from: 2, to: 2, insert: 'X' }, false);
  const mapped = backing.inlineContext(0, backing.length).listCodes![0];
  expect(mapped).toEqual(
    Object.fromEntries(
      Object.entries(code).map(([k, v]) => [k, typeof v === 'number' ? v + 1 : v]),
    ),
  );
  expect(backing.region(0)).toBe(source.slice(0, 2) + 'X' + source.slice(2));
});
