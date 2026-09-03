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
  { count: 1, state: 'attention', card: 'attention-four-questions', hasPr: false },
  { count: 2, state: 'working', card: 'working', hasPr: true },
  { count: 3, state: 'attention', card: 'attention-priority', hasPr: false },
  { count: 4, state: 'agents', card: 'agents-active', hasPr: false },
] as const;

for (const scene of landscapeRows) {
  test(`keeps a 640px card landscape with ${scene.count} activity rows`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 720, height: 640 });
    const preview = await mount(WorkspaceHoverCardPreview, {
      props: fixture(scene.state, scene.card),
    });
    const card = preview.locator('[data-workspace-hover-card]');
    const header = card.locator('[data-workspace-hover-card-header]');
    const title = card.locator('[data-workspace-hover-card-title]');
    const status = card.locator('[data-workspace-hover-card-status]');
    const activity = card.locator('[data-workspace-hover-card-activity]');
    const pullRequests = card.locator('[data-workspace-hover-card-pr-column]');
    const rows = card.locator('[data-workspace-hover-card-agent-row]');

    await expect(rows).toHaveCount(scene.count);
    await expect(pullRequests).toHaveCount(scene.hasPr ? 1 : 0);
    const [cardBox, activityBox, pullRequestsBox, titleBox, statusBox] = await Promise.all([
      card.boundingBox(),
      activity.boundingBox(),
      scene.hasPr ? pullRequests.boundingBox() : Promise.resolve(null),
      title.boundingBox(),
      status.boundingBox(),
    ]);
    expect(cardBox).not.toBeNull();
    expect(activityBox).not.toBeNull();
    expect(cardBox!.width).toBeCloseTo(640, 0);
    expect(titleBox).not.toBeNull();
    expect(statusBox).not.toBeNull();
    expect(cardBox!.width / cardBox!.height).toBeGreaterThanOrEqual(1.4);
    expect(cardBox!.x).toBeGreaterThanOrEqual(8);
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(712);
    if (scene.hasPr) {
      expect(pullRequestsBox).not.toBeNull();
      expect(activityBox!.width).toBeCloseTo(pullRequestsBox!.width, 0);
      expect(activityBox!.y).toBeCloseTo(pullRequestsBox!.y, 0);
      expect(activityBox!.height).toBeCloseTo(pullRequestsBox!.height, 0);
    } else {
      expect(pullRequestsBox).toBeNull();
    }
    expect(Math.abs(titleBox!.y - statusBox!.y)).toBeLessThanOrEqual(3);
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
  const pullRequests = card.locator('[data-workspace-hover-card-pr-column]');
  const bounds = await card.boundingBox();

  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(8);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(412);
  expect(
    await columns.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length),
  ).toBe(1);
  expect(await pullRequests.evaluate((node) => getComputedStyle(node).borderLeftWidth)).toBe('0px');
  expect(await pullRequests.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe('1px');
  await expect(card.locator('[data-workspace-hover-card-agent-time]')).toBeVisible();
  await expect(card.locator('[data-workspace-hover-card-agent-context]')).toBeVisible();
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

for (const theme of ['light', 'dark'] as const) {
  test(`keeps the lowest three ${theme} cards on the application background`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 720, height: 1280 });
    const state = workspaceHoverCardPreview.states[`landscape-${theme}`];
    if (!state) throw new Error(`Missing landscape ${theme} fixture`);
    const preview = await mount(WorkspaceHoverCardPreview, {
      props: { ...state.props, setupData: true },
    });
    const cards = preview.locator('[data-workspace-hover-card]');

    await expect(cards).toHaveCount(3);
    expect(await preview.getAttribute('class')).toContain(theme);
    const surfaces = await cards.evaluateAll((nodes) =>
      nodes.map((node) => {
        const elevatedProbe = document.createElement('span');
        const dockPlateProbe = document.createElement('span');
        elevatedProbe.style.backgroundColor = 'hsl(var(--popover))';
        dockPlateProbe.style.backgroundColor = 'hsl(var(--background))';
        node.append(elevatedProbe, dockPlateProbe);
        const result = {
          card: getComputedStyle(node).backgroundColor,
          elevated: getComputedStyle(elevatedProbe).backgroundColor,
          dockPlate: getComputedStyle(dockPlateProbe).backgroundColor,
        };
        elevatedProbe.remove();
        dockPlateProbe.remove();
        return result;
      }),
    );
    expect(new Set(surfaces.map(({ card }) => card)).size).toBe(1);
    for (const surface of surfaces) {
      expect(surface.card).not.toBe(surface.elevated);
      expect(surface.card).toBe(surface.dockPlate);
      expect(surface.card).not.toBe('rgba(0, 0, 0, 0)');
    }
  });
}

test('keeps the landscape loading skeleton at the target width', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  const preview = await mount(WorkspaceHoverCardPreview, {
    props: fixture('landscape-loading'),
  });
  const card = preview.locator('[data-workspace-hover-card]');

  await expect(card.locator('[data-slot="skeleton"]')).toHaveCount(6);
  expect((await card.boundingBox())?.width).toBeCloseTo(640, 0);
  await expect(card.locator('[data-workspace-hover-card-title]')).toHaveCount(0);
});

test('shows the real first question and its total count in the landscape activity column', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 560, height: 520 });
  const preview = await mount(WorkspaceHoverCardPreview, {
    props: fixture('landscape-question'),
  });
  const question = preview.locator('[data-workspace-hover-card-agent-context]');

  await expect(question).toHaveText('Which deployment region should receive the migration first?');
  const questionMeta = preview.locator('[data-workspace-hover-card-question-meta]');
  await expect(questionMeta.locator('[aria-hidden="true"]')).toHaveText('1/4');
  await expect(questionMeta).toHaveAccessibleName('Question 1 of 4');
  await expect(preview.locator('[data-workspace-hover-card-agent-preview]')).toHaveCount(0);
  const row = preview.locator('[data-workspace-hover-card-agent-row]');
  const name = preview.locator('[data-workspace-hover-card-agent-name]');
  const timestamp = preview.locator('[data-workspace-hover-card-agent-time]');
  const detail = preview.locator('[data-workspace-hover-card-agent-detail]');
  const [rowBox, nameBox, questionBox, timestampBox, detailBox] = await Promise.all([
    row.boundingBox(),
    name.boundingBox(),
    question.boundingBox(),
    timestamp.boundingBox(),
    detail.boundingBox(),
  ]);
  expect(rowBox).not.toBeNull();
  expect(nameBox).not.toBeNull();
  expect(questionBox).not.toBeNull();
  expect(timestampBox).not.toBeNull();
  expect(detailBox).not.toBeNull();
  expect(detailBox!.x).toBeCloseTo(nameBox!.x, 0);
  expect(detailBox!.x + detailBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
  expect(rowBox!.x + rowBox!.width - (timestampBox!.x + timestampBox!.width)).toBeLessThanOrEqual(
    13,
  );
  expect(Math.abs(timestampBox!.y - nameBox!.y)).toBeLessThanOrEqual(3);
  expect(detailBox!.y).toBeGreaterThanOrEqual(
    Math.max(nameBox!.y + nameBox!.height, timestampBox!.y + timestampBox!.height) - 1,
  );
  expect(await question.evaluate((node) => getComputedStyle(node).whiteSpace)).toBe('nowrap');
});

test('keeps sections accessible without visible headings or internal row dividers', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 520 });
  const preview = await mount(WorkspaceHoverCardPreview, {
    props: fixture('landscape-wide'),
  });
  await expect(preview.locator('[data-workspace-hover-card] h3')).toHaveCount(0);
  await expect(preview.locator('[data-workspace-hover-card-activity]')).toHaveAccessibleName(
    'Agents',
  );
  await expect(preview.locator('[data-workspace-hover-card-pr-column]')).toHaveAccessibleName(
    'Pull requests',
  );
  await expect(preview.locator('[data-agent-group]')).toHaveCount(0);
  const rowBorders = await preview
    .locator('[data-workspace-hover-card-agent-row]')
    .evaluateAll((rows) => rows.map((row) => getComputedStyle(row).borderBottomWidth));
  expect(rowBorders.every((width) => width === '0px')).toBe(true);
});
