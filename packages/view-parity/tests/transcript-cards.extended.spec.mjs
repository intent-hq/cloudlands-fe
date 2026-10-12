import {
  test,
  expect,
  openCards,
  applyPlan,
  applyDigest,
  mounted,
  capture,
  contained,
  expectLoader,
  sameNode,
  detached,
} from '../lib/transcript-cards.mjs';

test('transcript cards TC5: long prose remains contained at a real 420 viewport without loader announcements', async ({
  page,
}, info) => {
  const item = await openCards(page);
  await item.host.getByTestId('transcript-width-420').click();
  const planText =
    'Review the complete transcript and preserve every current input while keeping all words readable in the narrow card. '
      .repeat(3)
      .trim();
  const digestText =
    'The reviewer can read the complete summary with natural line wrapping and no horizontal clipping at the narrow viewport. '
      .repeat(3)
      .trim();
  await applyPlan(item, [
    { content: planText, priority: 'high', status: 'in_progress' },
    {
      content: 'Review the saved result after the current work finishes.',
      priority: 'low',
      status: 'pending',
    },
  ]);
  await applyDigest(item, digestText);
  await expect(item.rows.nth(0)).toContainText(planText);
  await expect(item.digest).toHaveText(digestText);
  await expectLoader(item, info);
  const actual = await contained(item, info, 'TC5-narrow');
  expect(
    actual.prose[0].ranges.length,
    'The long entry really wraps in the browser',
  ).toBeGreaterThan(1);
  expect(
    actual.prose.at(-1).ranges.length,
    'The long digest really wraps in the browser',
  ).toBeGreaterThan(1);
  const ax = await item.stack.ariaSnapshot();
  expect(ax).toContain(planText);
  expect(ax).toContain(digestText);
  await capture(page, item.stack, 'TC5-long-prose', info);
});

test('transcript cards TC6: adjacent cards keep independent identities through replacement and remount', async ({
  page,
}, info) => {
  const item = await openCards(page);
  await applyPlan(item, [{ content: 'Adjacent plan', priority: 'high', status: 'pending' }]);
  await applyDigest(item, 'Adjacent digest');
  const plan = await item.plan.elementHandle();
  const row = await item.rows.first().elementHandle();
  const digest = await item.digest.elementHandle();
  const bounds = await item.stack.evaluate((root) => {
    const plan = root.querySelector('[data-testid="execution-plan-card"]');
    const digest = root.querySelector('[data-testid="transcript-digest-frame"] > div');
    if (!plan || !digest) throw new Error('Both actual adjacent leaves must be mounted');
    return {
      planBottom: plan.getBoundingClientRect().bottom,
      digestTop: digest.getBoundingClientRect().top,
    };
  });
  expect(bounds.digestTop, 'The digest must not obscure the adjacent plan').toBeGreaterThanOrEqual(
    bounds.planBottom - 1,
  );
  await capture(page, item.stack, 'TC6-adjacent-before', info);
  await applyDigest(item, 'Current adjacent digest');
  await sameNode(item.plan, plan);
  await sameNode(item.rows.first(), row);
  await sameNode(item.digest, digest);
  await applyPlan(item, [
    { content: 'Replacement adjacent plan', priority: 'low', status: 'completed' },
  ]);
  await detached(row);
  await sameNode(item.plan, plan);
  await sameNode(item.digest, digest);
  await mounted(item, 'plan', false);
  await detached(plan);
  await sameNode(item.digest, digest);
  await expect(item.digest).toHaveText('Current adjacent digest');
  await mounted(item, 'plan', true);
  const restoredPlan = await item.plan.elementHandle();
  await expect(item.rows.first()).toContainText('Replacement adjacent plan');
  await item.host.getByTestId('transcript-digest-remount').click();
  await detached(digest);
  await sameNode(item.plan, restoredPlan);
  const remountedDigest = await item.digest.elementHandle();
  await mounted(item, 'digest', false);
  await detached(remountedDigest);
  await sameNode(item.plan, restoredPlan);
  await mounted(item, 'digest', true);
  await expect(item.digest).toHaveText('Current adjacent digest');
  await capture(page, item.stack, 'TC6-adjacent-after', info);
  for (const node of [plan, row, digest, restoredPlan, remountedDigest]) await node.dispose();
});
