import { expect, test } from '@playwright/experimental-ct-svelte';
import WorkspaceHoverCardPreview from './workspace-hover-card.preview.svelte';
import {
  workspaceHoverCardPreview,
  type WorkspaceHoverCardPreviewProps,
} from './workspace-hover-card.preview-fixtures';

function fixture(stateName: string, cardKey?: string): WorkspaceHoverCardPreviewProps {
  const state = workspaceHoverCardPreview.states[stateName];
  if (!state) throw new Error(`Missing workspace hover-card fixture: ${stateName}`);
  const card = cardKey
    ? state.props.cards.find(({ key }) => key === cardKey)
    : state.props.cards[0];
  if (!card) throw new Error(`Missing workspace hover-card scenario: ${cardKey ?? stateName}`);
  return { ...state.props, cards: [card], setupData: true };
}

const landscapeRows = [
  { count: 1, state: 'attention', card: 'attention-four-questions' },
  { count: 2, state: 'working', card: 'working' },
  { count: 3, state: 'attention', card: 'attention-priority' },
  { count: 4, state: 'agents', card: 'agents-active' },
] as const;

for (const scene of landscapeRows) {
  test(`keeps a 640px host landscape with ${scene.count} activity rows`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 640 });
    const preview = await mount(WorkspaceHoverCardPreview, {
      props: fixture(scene.state, scene.card),
    });
    const card = preview.locator('[data-workspace-hover-card]');
    const header = card.locator('[data-workspace-hover-card-header]');
    const identity = card.locator('[data-workspace-hover-card-identity]');
    const activity = card.locator('[data-workspace-hover-card-activity]');
    const rows = card.locator('[data-workspace-hover-card-agent-row]');

    await expect(rows).toHaveCount(scene.count);
    const [cardBox, identityBox, activityBox] = await Promise.all([
      card.boundingBox(),
      identity.boundingBox(),
      activity.boundingBox(),
    ]);
    expect(cardBox).not.toBeNull();
    expect(identityBox).not.toBeNull();
    expect(activityBox).not.toBeNull();
    expect(cardBox!.width).toBeCloseTo(576, 0);
    expect(cardBox!.width / cardBox!.height).toBeGreaterThanOrEqual(1.5);
    expect(cardBox!.x).toBeGreaterThanOrEqual(8);
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(632);
    expect(identityBox!.width / cardBox!.width).toBeCloseTo(0.42, 1);
    expect(activityBox!.width / cardBox!.width).toBeCloseTo(0.58, 1);
    expect(await header.evaluate((node) => getComputedStyle(node).flexDirection)).toBe('row');
    expect(await header.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    expect(
      await activity.evaluate((node) => {
        const overflow = getComputedStyle(node).overflowY;
        return overflow !== 'auto' && overflow !== 'scroll';
      }),
    ).toBe(true);
    await expect(card.locator('[data-workspace-hover-card-agent-time]')).toHaveCount(scene.count);
  });
}

test('stacks only in the explicit narrow fixture without horizontal clipping', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 720 });
  const preview = await mount(WorkspaceHoverCardPreview, {
    props: fixture('landscape-narrow'),
  });
  const card = preview.locator('[data-workspace-hover-card]');
  const columns = card.locator('[data-workspace-hover-card-columns]');
  const activity = card.locator('[data-workspace-hover-card-activity]');
  const bounds = await card.boundingBox();

  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(8);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(412);
  expect(
    await columns.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length),
  ).toBe(1);
  expect(await activity.evaluate((node) => getComputedStyle(node).borderLeftWidth)).toBe('0px');
  expect(await activity.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe('1px');
  await expect(card.locator('[data-workspace-hover-card-agent-time]')).toBeVisible();
  await expect(card.locator('[data-workspace-hover-card-agent-context]')).toBeHidden();
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

for (const theme of ['light', 'dark'] as const) {
  test(`renders the ${theme} landscape fixture with an opaque surface`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 640, height: 520 });
    const preview = await mount(WorkspaceHoverCardPreview, {
      props: fixture(`landscape-${theme}`),
    });
    const card = preview.locator('[data-workspace-hover-card]');

    await expect(card).toBeVisible();
    expect(await preview.getAttribute('class')).toContain(theme);
    expect(await card.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
      'rgba(0, 0, 0, 0)',
    );
  });
}

test('keeps the landscape loading skeleton at the target width', async ({ mount, page }) => {
  await page.setViewportSize({ width: 640, height: 520 });
  const preview = await mount(WorkspaceHoverCardPreview, {
    props: fixture('landscape-loading'),
  });
  const card = preview.locator('[data-workspace-hover-card]');

  await expect(card.locator('[data-slot="skeleton"]')).toHaveCount(5);
  expect((await card.boundingBox())?.width).toBeCloseTo(576, 0);
  await expect(card.locator('[data-workspace-hover-card-title]')).toHaveCount(0);
});

test('shows the real first question and its total count in the landscape activity column', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 520 });
  const preview = await mount(WorkspaceHoverCardPreview, {
    props: fixture('landscape-question'),
  });
  const question = preview.locator('[data-workspace-hover-card-agent-context]');

  await expect(question).toHaveText('Which deployment region should receive the migration first?');
  await expect(preview.locator('[data-workspace-hover-card-question-meta]')).toHaveText(
    'Question 1 of 4',
  );
  await expect(preview.locator('[data-workspace-hover-card-agent-preview]')).toHaveText(
    'The deployment plan is ready after these decisions.',
  );
});

test('uses plain activity group labels with restrained separators', async ({ mount, page }) => {
  await page.setViewportSize({ width: 640, height: 520 });
  const preview = await mount(WorkspaceHoverCardPreview, {
    props: fixture('landscape-wide'),
  });
  const heading = preview.locator('[data-agent-group] h3').first();

  await expect(heading).toBeVisible();
  expect(await heading.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    'rgba(0, 0, 0, 0)',
  );
  expect(await heading.evaluate((node) => getComputedStyle(node).borderBottomWidth)).toBe('1px');
});
