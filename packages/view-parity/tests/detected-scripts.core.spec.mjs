// Ignored draft; one separately released case once, then manual image/guard review.
import {
  test,
  expect,
  openDetected,
  control,
  apply,
  expectRow,
  footer,
  expectOriginalIcon,
  capture,
  geometry,
  service,
  command,
} from '../lib/detected-scripts.mjs';

test('detected scripts DS1: empty singular and many render original localized summaries and artwork', async ({
  page,
}, info) => {
  const item = await openDetected(page);
  await control(item, 'Load empty draft').click();
  await control(item, 'Apply scripts').click();
  await expect(item.rows).toHaveCount(0);
  await footer(item, 'chat_detectedScripts_count_many', 0);
  await expectOriginalIcon(item, info);
  await geometry(item, 'empty', info);
  await capture(item, 'empty', info);

  const first = { name: 'Compile', command: 'pnpm build', mode: 'command' };
  await apply(item, [first]);
  await expect(item.rows).toHaveCount(1);
  await expectRow(item.rows.nth(0), { ...first, badges: [command] });
  await footer(item, 'chat_detectedScripts_count_one', 1);
  await capture(item, 'singular', info);

  const second = {
    name: 'Development',
    command: 'pnpm dev',
    mode: 'service',
    category: 'development',
  };
  const third = { name: 'Inspect', command: 'pnpm inspect', mode: 'custom', category: 'other' };
  await apply(item, [first, second, third]);
  await expect(item.rows).toHaveCount(3);
  await expectRow(item.rows.nth(0), { ...first, badges: [command] });
  await expectRow(item.rows.nth(1), { ...second, badges: [service, 'development'] });
  await expectRow(item.rows.nth(2), { ...third, badges: [command] });
  await footer(item, 'chat_detectedScripts_count_many', 3);
  await geometry(item, 'many', info);
  await capture(item, 'many', info);
});

test('detected scripts DS2: exact mode and optional category branches preserve raw values', async ({
  page,
}, info) => {
  const item = await openDetected(page);
  const scenarios = [
    { input: { name: 'Absent', command: 'pnpm absent', mode: 'service' }, badges: [service] },
    {
      input: { name: 'Empty', command: 'pnpm empty', mode: 'command', category: '' },
      badges: [command],
    },
    {
      input: { name: 'Other', command: 'pnpm other', mode: '', category: 'other' },
      badges: [command],
    },
    {
      input: { name: 'Exact case', command: 'pnpm case', mode: 'Service', category: 'Other' },
      badges: [command, 'Other'],
    },
    {
      input: { name: 'Named', command: 'pnpm named', mode: 'custom mode', category: 'quality' },
      badges: [command, 'quality'],
    },
    {
      input: {
        name: 'Named service',
        command: 'pnpm serve',
        mode: 'service',
        category: 'development',
      },
      badges: [service, 'development'],
    },
  ];
  await apply(
    item,
    scenarios.map(({ input }) => input),
  );
  await expect(item.rows).toHaveCount(6);
  for (const [index, { input, badges }] of scenarios.entries())
    await expectRow(item.rows.nth(index), { ...input, badges });
  await footer(item, 'chat_detectedScripts_count_many', 6);
  await geometry(item, 'branch-array', info);
  await capture(item, 'branch-array', info);
});

test('detected scripts DS3: markup-looking input stays text and long commands remain contained at narrow width', async ({
  page,
}, info) => {
  const item = await openDetected(page);
  const input = {
    name: '<b>raw 雪</b>',
    command:
      'printf "<script>plain text</script>" && echo "& **literal**" -- ' +
      'LongArgument'.repeat(60),
    mode: '',
    category: '<i>raw</i>',
  };
  await item.host.getByTestId('detected-scripts-width-420').click();
  await apply(item, [input]);
  await expect(item.rows).toHaveCount(1);
  const fields = await expectRow(item.rows.nth(0), { ...input, badges: [command, input.category] });
  await expect(fields.name.locator('*')).toHaveCount(0);
  await expect(fields.command.locator('*')).toHaveCount(0);
  await expect(fields.heading.locator(':scope > span').nth(2).locator('*')).toHaveCount(0);
  await footer(item, 'chat_detectedScripts_count_one', 1);
  await geometry(item, 'literal-long-command-420', info, { commandOverflow: true });
  await capture(item, 'literal-long-command-420', info);
});
