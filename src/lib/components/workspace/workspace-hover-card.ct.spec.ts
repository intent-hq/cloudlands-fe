import { expect, test } from '../../../test/ct-test';
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

const stackedRows = [
  { count: 1, state: 'attention', card: 'attention-four-questions', hasPr: false },
  { count: 2, state: 'working', card: 'working', hasPr: true },
  { count: 3, state: 'attention', card: 'attention-priority', hasPr: false },
  { count: 4, state: 'agents', card: 'agents-active', hasPr: false },
] as const;

for (const scene of stackedRows) {
  test(`contains a stacked card with ${scene.count} activity rows`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 720, height: 640 });
    const preview = await mount(WorkspaceHoverCardPreview, {
      props: fixture(scene.state, scene.card),
    });
    const card = preview.locator('[data-workspace-hover-card]');
    const header = card.locator('[data-workspace-hover-card-header]');
    const title = card.locator('[data-workspace-hover-card-title]');
    const status = card.locator('[data-workspace-hover-card-status]');
    const columns = card.locator('[data-workspace-hover-card-columns]');
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
    expect(titleBox).not.toBeNull();
    expect(statusBox).not.toBeNull();
    expect(cardBox!.x).toBeGreaterThanOrEqual(0);
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(
      await columns.evaluate(
        (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length,
      ),
    ).toBe(1);
    if (scene.hasPr) {
      expect(pullRequestsBox).not.toBeNull();
    } else {
      expect(pullRequestsBox).toBeNull();
    }
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

test('keeps the narrow stacked fixture inside the viewport without clipping', async ({
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
  const pullRequests = card.locator('[data-workspace-hover-card-pr-column]');
  const [bounds, activityBox, pullRequestsBox] = await Promise.all([
    card.boundingBox(),
    activity.boundingBox(),
    pullRequests.boundingBox(),
  ]);

  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(
    await columns.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length),
  ).toBe(1);
  expect(activityBox).not.toBeNull();
  expect(pullRequestsBox).not.toBeNull();
  await expect(card.locator('[data-workspace-hover-card-agent-time]')).toBeVisible();
  await expect(card.locator('[data-workspace-hover-card-agent-context]')).toBeVisible();
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test('keeps the status label and indicator contained without overlap', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 640 });
  const preview = await mount(WorkspaceHoverCardPreview, {
    props: fixture('working'),
  });
  const card = preview.locator('[data-workspace-hover-card]');
  const header = card.locator('[data-workspace-hover-card-header]');
  const status = card.locator('[data-workspace-hover-card-status]');
  const label = status.locator('[data-workspace-hover-card-status-label]');
  const indicator = status.locator('[data-workspace-status]');
  const [headerBox, statusBox, labelBox, indicatorBox] = await Promise.all([
    header.boundingBox(),
    status.boundingBox(),
    label.boundingBox(),
    indicator.boundingBox(),
  ]);

  expect(headerBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(indicatorBox).not.toBeNull();
  expect(indicatorBox!.x).toBeGreaterThanOrEqual(labelBox!.x + labelBox!.width);
  expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width);
  expect(await status.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

for (const { state, width } of [
  { state: 'working', width: 720 },
  { state: 'landscape-question', width: 720 },
  { state: 'landscape-question', width: 420 },
]) {
  test(`contains activity rows for ${state} at ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 720 });
    const preview = await mount(WorkspaceHoverCardPreview, { props: fixture(state) });
    const card = preview.locator('[data-workspace-hover-card]');
    const rows = card.locator('[data-workspace-hover-card-agent-row]');
    await expect(rows.first()).toBeVisible();
    const geometry = await card.evaluate((node) => {
      const bounds = (selector: string, root: Element = node) => {
        const element = root.querySelector(selector);
        if (!element) throw new Error(`Missing density target: ${selector}`);
        return element.getBoundingClientRect().toJSON();
      };
      return {
        card: node.getBoundingClientRect().toJSON(),
        summary: bounds('[data-workspace-hover-card-summary]'),
        divider: bounds('[data-workspace-hover-card-divider]'),
        rows: Array.from(node.querySelectorAll('[data-workspace-hover-card-agent-row]')).map(
          (row) => ({
            row: row.getBoundingClientRect().toJSON(),
            avatar: bounds('[data-agent-avatar-with-state]', row),
            name: bounds('[data-workspace-hover-card-agent-name]', row),
            context: bounds('[data-workspace-hover-card-agent-context]', row),
            time: bounds('[data-workspace-hover-card-agent-time]', row),
          }),
        ),
        pr: bounds('[data-workspace-hover-card-pr-row]'),
        prIcon: bounds('[data-workspace-hover-card-pr-row] svg'),
        prTitle: bounds('[data-workspace-hover-card-pr-title]'),
        overflows: node.scrollWidth > node.clientWidth,
      };
    });

    expect(geometry.rows.length).toBe(state === 'working' ? 2 : 1);
    expect(geometry.overflows).toBe(false);
    expect(geometry.card.x).toBeGreaterThanOrEqual(0);
    expect(geometry.card.right).toBeLessThanOrEqual(width - 8);
    for (const row of geometry.rows) {
      expect(row.time.right).toBeLessThanOrEqual(row.row.right + 1);
    }
    if (width === 420) {
      const context = card.locator('[data-workspace-hover-card-agent-context]');
      expect(await context.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
      await expect(card.locator('[data-workspace-hover-card-question-meta]')).toHaveAccessibleName(
        'Question 1 of 4',
      );
    }
  });
}

test('uses accessible muted foreground for secondary metadata', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  const preview = await mount(WorkspaceHoverCardPreview, {
    props: fixture('working'),
  });
  const card = preview.locator('[data-workspace-hover-card]');
  await expect(card.locator('[data-workspace-hover-card-agent-time]').first()).toBeVisible();
  const styles = await card.evaluate((node) => {
    const renderedColor = (color: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas color normalization is unavailable');
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const read = (selector: string) => {
      const element = node.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`Missing metadata: ${selector}`);
      const style = getComputedStyle(element);
      return { color: renderedColor(style.color), fontSize: style.fontSize };
    };
    const probe = document.createElement('span');
    probe.style.color = 'hsl(var(--muted-foreground))';
    node.append(probe);
    const mutedForeground = renderedColor(getComputedStyle(probe).color);

    const relativeLuminance = ([red, green, blue]: number[]) => {
      const [r, g, b] = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const background = renderedColor(getComputedStyle(node).backgroundColor);
    const foregroundLuminance = relativeLuminance(mutedForeground);
    const backgroundLuminance = relativeLuminance(background);
    const contrastRatio =
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    probe.remove();
    return {
      mutedForeground,
      contrastRatio,
      repo: read('[data-workspace-hover-card-repo]'),
      timestamp: read('[data-workspace-hover-card-agent-time]'),
      prStatus: read('[data-workspace-hover-card-pr-status]'),
      workspaceStatus: read('[data-workspace-hover-card-status]'),
      agentDetail: read('[data-workspace-hover-card-agent-detail]'),
      prNumber: read('[data-workspace-hover-card-pr-number]'),
    };
  });
  expect(styles.repo.color).toEqual(styles.mutedForeground);
  expect(styles.timestamp.color).toEqual(styles.mutedForeground);
  expect(styles.prStatus.color).toEqual(styles.mutedForeground);
  expect(styles.prNumber.color).toEqual(styles.mutedForeground);
  expect(styles.contrastRatio).toBeGreaterThanOrEqual(4.5);
  await expect(
    card.locator('[data-workspace-hover-card-status] [data-workspace-status]'),
  ).toHaveCount(1);
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
      // Batch 18-F makes popovers match the page/card surface in both themes.
      expect(surface.card).toBe(surface.elevated);
      expect(surface.card).toBe(surface.dockPlate);
      expect(surface.card).not.toBe('rgba(0, 0, 0, 0)');
    }
  });
}

test('keeps the loading skeleton contained', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  const preview = await mount(WorkspaceHoverCardPreview, {
    props: fixture('landscape-loading'),
  });
  const card = preview.locator('[data-workspace-hover-card]');
  const columns = card.locator('[data-workspace-hover-card-columns]');
  const activity = card.locator('[data-workspace-hover-card-activity]');
  const pullRequests = card.locator('[data-workspace-hover-card-pr-column]');

  await expect(card.locator('[data-slot="skeleton"]')).toHaveCount(6);
  expect(
    await columns.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length),
  ).toBe(1);
  const [activityBox, pullRequestsBox] = await Promise.all([
    activity.boundingBox(),
    pullRequests.boundingBox(),
  ]);
  expect(activityBox).not.toBeNull();
  expect(pullRequestsBox).not.toBeNull();
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
