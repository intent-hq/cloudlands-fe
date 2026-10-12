import {
  test,
  expect,
  openCards,
  applyPlan,
  applyDigest,
  mounted,
  label,
  capture,
  expectArtwork,
  expectLoader,
  sameNode,
  detached,
} from '../lib/transcript-cards.mjs';

test('transcript cards TC1: empty plans and current-step priority retain canonical labels', async ({
  page,
}, info) => {
  const item = await openCards(page);
  await applyPlan(item, []);
  await expect(item.plan).toHaveCount(0);
  await expect(item.planFrame.getByRole('region')).toHaveCount(0);
  // Explicit examples are independent of the candidate's step-selection algorithm.
  const cases = [
    { statuses: ['pending', 'pending', 'pending'], step: '1' },
    { statuses: ['completed', 'pending', 'pending'], step: '2' },
    { statuses: ['pending', 'in_progress', 'in_progress'], step: '2' },
    { statuses: ['completed', 'completed', 'in_progress'], step: '3' },
    { statuses: ['completed', 'completed', 'completed'], step: '3' },
  ];
  for (const [index, example] of cases.entries()) {
    await applyPlan(
      item,
      example.statuses.map((status, row) => ({
        content: ['First task', 'Second task', 'Third task'][row],
        priority: ['low', 'high', 'medium'][row],
        status,
      })),
    );
    await expect(item.plan).toHaveAccessibleName(label('chat_executionPlan_title'));
    await expect(item.plan.getByRole('heading', { level: 3 })).toHaveText(
      label('chat_executionPlan_title'),
    );
    await expect(item.plan).toContainText(
      label('chat_executionPlan_step_label', { current: example.step, total: '3' }),
    );
    await capture(page, item.planFrame, `TC1-state-${index + 1}`, info);
  }
  const old = await item.plan.elementHandle();
  await applyPlan(item, []);
  await detached(old);
  await expect(item.planFrame.getByRole('region')).toHaveCount(0);
  await applyPlan(item, [{ content: 'Restored task', priority: 'high', status: 'pending' }]);
  await expect(item.plan).toContainText(
    label('chat_executionPlan_step_label', { current: '1', total: '1' }),
  );
  await capture(page, item.planFrame, 'TC1-restored', info);
  await old.dispose();
});

test('transcript cards TC2: status semantics and decorative artwork match the original source', async ({
  page,
}, info) => {
  const item = await openCards(page);
  await applyPlan(item, [
    { content: 'Pending task', priority: 'low', status: 'pending' },
    { content: 'Current task', priority: 'medium', status: 'in_progress' },
    { content: 'Completed task', priority: 'high', status: 'completed' },
  ]);
  await expect(item.rows).toHaveText([
    `${label('chat_executionPlan_pending_label')}: Pending task`,
    `${label('chat_executionPlan_current_label')}: Current task`,
    `${label('chat_executionPlan_completed_label')}: Completed task`,
  ]);
  await expect(item.rows.nth(0)).not.toHaveAttribute('aria-current');
  await expect(item.rows.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(item.rows.nth(2)).not.toHaveAttribute('aria-current');
  await expectArtwork(item.plan.locator(':scope > div svg'), 'faListCheck', info);
  await expectArtwork(item.rows.nth(0).locator('svg'), 'faCircle', info);
  await expectArtwork(item.rows.nth(2).locator('svg'), 'faCheck', info);
  await expectLoader(item, info);
  const ax = await item.plan.ariaSnapshot();
  for (const text of ['Pending task', 'Current task', 'Completed task']) expect(ax).toContain(text);
  await capture(page, item.planFrame, 'TC2-statuses', info);
  await applyPlan(item, [
    { content: 'Pending task', priority: 'low', status: 'in_progress' },
    { content: 'Current task', priority: 'medium', status: 'completed' },
    { content: 'Completed task', priority: 'high', status: 'pending' },
  ]);
  await expect(item.rows.nth(0)).toHaveAttribute('aria-current', 'step');
  await expect(item.rows.nth(1)).not.toHaveAttribute('aria-current');
  await expect(item.rows.nth(2)).not.toHaveAttribute('aria-current');
  await expect(item.rows).toHaveText([
    `${label('chat_executionPlan_current_label')}: Pending task`,
    `${label('chat_executionPlan_completed_label')}: Current task`,
    `${label('chat_executionPlan_pending_label')}: Completed task`,
  ]);
  await expectLoader(item, info);
  await capture(page, item.planFrame, 'TC2-statuses-updated', info);
});

test('transcript cards TC3: index-content keys preserve status updates and replace changed identities', async ({
  page,
}, info) => {
  const item = await openCards(page);
  const initial = [
    { content: 'Alpha', priority: 'high', status: 'pending' },
    { content: 'Beta', priority: 'medium', status: 'in_progress' },
    { content: 'Gamma', priority: 'low', status: 'completed' },
  ];
  await applyPlan(item, initial);
  const root = await item.plan.elementHandle();
  const before = await item.rows.elementHandles();
  await capture(page, item.planFrame, 'TC3-before', info);
  const statuses = [
    { content: 'Alpha', priority: 'low', status: 'in_progress' },
    { content: 'Beta', priority: 'high', status: 'completed' },
    { content: 'Gamma', priority: 'medium', status: 'pending' },
  ];
  await applyPlan(item, statuses);
  for (let index = 0; index < 3; index += 1) await sameNode(item.rows.nth(index), before[index]);
  await item.host.getByTestId('transcript-parent-input').fill('Unrelated parent update');
  await sameNode(item.plan, root);
  for (let index = 0; index < 3; index += 1) await sameNode(item.rows.nth(index), before[index]);
  await applyPlan(item, [statuses[0], { ...statuses[1], content: 'Beta edited' }, statuses[2]]);
  await detached(before[1]);
  await sameNode(item.rows.nth(0), before[0]);
  await sameNode(item.rows.nth(2), before[2]);
  const edited = await item.rows.nth(1).elementHandle();
  await applyPlan(item, [statuses[2], { ...statuses[1], content: 'Beta edited' }, statuses[0]]);
  await detached(before[0]);
  await detached(before[2]);
  await sameNode(item.rows.nth(1), edited);
  const reordered = await item.rows.elementHandles();
  await applyPlan(item, initial);
  for (const row of reordered) await detached(row);
  await sameNode(item.plan, root);
  const replacement = await item.rows.elementHandles();
  await item.host.getByTestId('transcript-plan-remount').click();
  await detached(root);
  for (const row of replacement) await detached(row);
  await expect(item.rows).toHaveCount(3);
  await expect(item.rows.nth(1)).toContainText('Beta');
  await capture(page, item.planFrame, 'TC3-remounted', info);
  for (const node of [root, ...before, edited, ...reordered, ...replacement]) await node.dispose();
});

test('transcript cards TC4: digest updates remain literal text with empty and multiline input', async ({
  page,
}, info) => {
  const item = await openCards(page);
  await applyDigest(item, 'Initial digest text.');
  const root = await item.digest.elementHandle();
  await capture(page, item.digestFrame, 'TC4-before', info);
  const literal =
    '<strong>Literal</strong> &amp; **not Markdown** <script>no script</script> [link](https://example.test)';
  for (const value of [
    literal,
    'First line.\n\nSecond line.\n  Final text.',
    '',
    'Current digest Café 雪',
  ]) {
    await applyDigest(item, value);
    await sameNode(item.digest, root);
    await expect(item.digest.locator('*')).toHaveCount(0);
    await expect(item.digestFrame.getByRole('link')).toHaveCount(0);
    await expect(item.digestFrame.getByRole('button')).toHaveCount(0);
    await capture(
      page,
      item.digestFrame,
      `TC4-update-${value === literal ? 'literal' : value === '' ? 'empty' : value.startsWith('First') ? 'multiline' : 'current'}`,
      info,
    );
  }
  await item.host.getByTestId('transcript-parent-input').fill('Keep digest current');
  await sameNode(item.digest, root);
  await expect(item.digest).toHaveText('Current digest Café 雪');
  await mounted(item, 'digest', false);
  await detached(root);
  await expect(item.digest).toHaveCount(0);
  await mounted(item, 'digest', true);
  await expect(item.digest).toHaveText('Current digest Café 雪');
  await capture(page, item.digestFrame, 'TC4-restored', info);
  await root.dispose();
});
