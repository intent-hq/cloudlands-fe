// Ignored draft: no discovery or execution until separately released.
import {
  test,
  expect,
  openGroups,
  choice,
  button,
  seed,
  expanded,
  capture,
  detached,
  sameNode,
  owners,
  labels,
  expectArtwork,
  receipts,
  scrollState,
  bottom,
  wheel,
  grow,
} from '../lib/response-group.mjs';

test('response-group RG1 automatic streaming changes the live child branch', async ({
  page,
}, info) => {
  const item = await openGroups(page);
  await choice(item.host, 'Primary blocks', 'empty');
  await choice(item.host, 'Primary isStreaming', 'true');
  await expanded(item.primary, true);
  const detailsChild = await item.primary.child.elementHandle();
  await capture(page, item, 'RG1-streaming-details', info);
  await choice(item.host, 'Primary blocks', 'tool-result');
  await expanded(item.primary, false);
  await expect(item.primary.preview).toHaveCount(1);
  await expect(item.primary.root.getByTestId('response-group-snippet')).toHaveCount(0);
  await expect(item.primary.trigger).toHaveAccessibleName('Primary work');
  await detached(detailsChild);
  const previewChild = await item.primary.child.elementHandle();
  await choice(item.host, 'Primary blocks', 'mixed');
  await sameNode(item.primary.child, previewChild);
  await capture(page, item, 'RG1-streaming-preview', info);
  await choice(item.host, 'Primary blocks', 'empty');
  await expanded(item.primary, true);
  await expect(item.primary.preview).toHaveCount(0);
  await detached(previewChild);
  await expect(item.primary.child).toHaveCount(1);
  await capture(page, item, 'RG1-current-details', info);
});

test('response-group RG2 terminal completion differs from an idle terminal edge', async ({
  page,
}, info) => {
  const item = await openGroups(page);
  await expanded(item.primary, false);
  await choice(item.host, 'Primary isTerminal', 'true');
  await choice(item.host, 'Primary isLastConversationMessage', 'true');
  await expanded(item.primary, false);
  await button(item.host, 'Remount Primary').click();
  await expanded(item.primary, true);
  await capture(page, item, 'RG2-initial-terminal-last', info);
  await choice(item.host, 'Primary isTerminal', 'false');
  await expanded(item.primary, false); // Actual timer, eventual condition; no elapsed budget.
  await choice(item.host, 'Primary isTerminal', 'true');
  await expanded(item.primary, false);
  await choice(item.host, 'Primary isStreaming', 'true');
  await expect(item.primary.preview).toHaveCount(1);
  await button(item.primary.child, 'Primary finish stream').click();
  await expanded(item.primary, true);
  await expect(item.primary.preview).toHaveCount(0);
  await capture(page, item, 'RG2-stream-terminal-completion', info);
});

test('response-group RG3 manual overrides preserve their streaming lifetime', async ({
  page,
}, info) => {
  const item = await openGroups(page);
  await choice(item.host, 'Primary isStreaming', 'true');
  await item.primary.trigger.click();
  await expanded(item.primary, true);
  await choice(item.host, 'Primary blocks', 'empty');
  await choice(item.host, 'Primary blocks', 'mixed');
  await expanded(item.primary, true);
  expect((await owners(item)).at(-1).value.override).toBe('expanded-live');
  await button(item.primary.child, 'Primary finish stream').click();
  await expanded(item.primary, false);
  await item.primary.trigger.click();
  await expanded(item.primary, true);
  expect((await owners(item)).at(-1).value.override).toBe('expanded-completed');
  await choice(item.host, 'Primary isStreaming', 'true');
  await expanded(item.primary, false);
  expect((await owners(item)).at(-1).value.override).toBe('automatic');
  await item.primary.trigger.click();
  await item.primary.trigger.click();
  await expanded(item.primary, false);
  await choice(item.host, 'Primary isTerminal', 'true');
  await button(item.primary.child, 'Primary finish stream').click();
  await expanded(item.primary, false);
  await expect(item.primary.child).toHaveCount(0);
  expect((await owners(item)).at(-1).value.override).toBe('collapsed');
  await capture(page, item, 'RG3-manual-terminal-collapse', info);
});

test('response-group RG4 retained seeds respect automatic and search ownership', async ({
  page,
}, info) => {
  const item = await openGroups(page);
  await seed(item, { expanded: 'true', override: 'expanded-completed' });
  await expanded(item.primary, true);
  await button(item.host, 'Remount Primary').click();
  await expanded(item.primary, true);
  await capture(page, item, 'RG4-retained-completed', info);
  await seed(item, { expanded: 'true', override: 'automatic' });
  await expanded(item.primary, false);
  expect((await owners(item)).at(-1).value.expanded).toBe(false);
  await seed(item, { expanded: 'true', search: 'true', override: 'automatic' });
  await expanded(item.primary, true);
  await button(item.host, 'Primary search restore').click();
  await expanded(item.primary, false);
  expect((await owners(item)).at(-1).value).toMatchObject({
    expanded: false,
    searchOwnsExpansion: false,
    override: 'automatic',
  });
  await capture(page, item, 'RG4-search-owner-restored', info);
});

test('response-group RG6 the real collapse timer returns focus from its child', async ({
  page,
}, info) => {
  const item = await openGroups(page);
  await choice(item.host, 'Primary blocks', 'empty');
  await choice(item.host, 'Primary isStreaming', 'true');
  await expanded(item.primary, true);
  const child = await item.primary.child.elementHandle();
  await capture(page, item, 'RG6-before-completion', info);
  const finish = button(item.primary.child, 'Primary finish stream');
  await finish.click();
  await expect(finish).toBeFocused();
  await expanded(item.primary, false);
  await expect(item.primary.trigger).toBeFocused();
  await detached(child);
  await capture(page, item, 'RG6-eventual-collapse-focus', info);
  const log = await receipts(item, info, 'RG6-completion');
  expect(
    log.callbacks.filter((r) => r.kind === 'finish-stream' && r.label === 'Primary'),
  ).toHaveLength(1);
  expect(
    log.callbacks.find((r) => r.kind === 'finish-stream' && r.label === 'Primary').event,
  ).toMatchObject({ isTrusted: true, type: 'click' });
  info.annotations.push({
    type: 'coverage-limit',
    description:
      'No elapsed-time performance budget, fake clock or inference about pending cleanup/cancellation.',
  });
});

test('response-group RG9 current summaries preserve source localization and artwork', async ({
  page,
}, info) => {
  const item = await openGroups(page);
  const raw = '[read](#read) **first summary**';
  await item.host
    .getByRole('textbox', { name: 'Primary name', exact: true })
    .fill('Inspect response');
  await item.host.getByRole('textbox', { name: 'Primary raw text', exact: true }).fill(raw);
  await choice(item.host, 'Primary blocks', 'mixed');
  await expanded(item.primary, false);
  await expect(item.primary.trigger).toHaveAccessibleName(`Inspect response: ${raw}`);
  const snippet = item.primary.root.getByTestId('response-group-snippet');
  await expect(snippet).toHaveText('read first summary');
  await expect(snippet.getByRole('link')).toHaveCount(0);
  await expect(snippet.getByRole('button')).toHaveCount(0);
  await expectArtwork(item.primary, 'faArrowsInLineVertical', info);
  await capture(page, item, 'RG9-first-eligible-summary', info);
  await item.primary.trigger.click();
  await expanded(item.primary, true);
  await expectArtwork(item.primary, 'faArrowsOutLineVertical', info);
  await choice(item.host, 'Primary reasoningPhase', 'true');
  await item.host.getByRole('textbox', { name: 'Primary name', exact: true }).fill('   ');
  await expect(item.primary.trigger).toHaveAccessibleName(labels.reasoning);
  await choice(item.host, 'Primary isStreaming', 'true');
  await expect(item.primary.trigger).toHaveAccessibleName(labels.thinking);
  await expect(item.primary.root.getByTestId('response-group-snippet')).toHaveCount(0);
  await capture(page, item, 'RG9-reasoning-stream', info);
  await button(item.primary.child, 'Primary finish stream').click();
  await expect(item.primary.trigger).toHaveAccessibleName(labels.reasoning);
});

test('response-group RG10 cylinder wheel input pauses and resumes growth following', async ({
  page,
}, info) => {
  const item = await openGroups(page);
  await bottom(item.cylinder);
  const initial = await scrollState(item.cylinder);
  expect(initial.total).toBeGreaterThan(initial.height);
  await grow(item);
  await bottom(item.cylinder);
  await capture(page, item, 'RG10-following-growth', info, item.cylinderFrame);
  const beforeUp = await scrollState(item.cylinder);
  await wheel(page, item.cylinder, -500);
  await expect
    .poll(async () => (await scrollState(item.cylinder)).top)
    .toBeLessThan(beforeUp.top - 5);
  await grow(item);
  await expect
    .poll(async () => {
      const s = await scrollState(item.cylinder);
      return s.total - s.height - s.top;
    })
    .toBeGreaterThan(5);
  await capture(page, item, 'RG10-reader-paused', info, item.cylinderFrame);
  await wheel(page, item.cylinder, 100000);
  await bottom(item.cylinder);
  await grow(item);
  await bottom(item.cylinder);
  await capture(page, item, 'RG10-follow-resumed', info, item.cylinderFrame);
});
