import { expect, test } from '@playwright/experimental-ct-svelte';
import QueuedMessageGeometryHost from './QueuedMessageGeometryHost.svelte';

for (const state of [
  { name: 'narrow', width: 240, zoom: 1 },
  { name: 'narrow at 200% zoom', width: 120, zoom: 2 },
]) {
  test(`keeps queued-message row height stable at ${state.name}`, async ({ mount }) => {
    const component = await mount(QueuedMessageGeometryHost, { props: state });
    const row = component.getByTestId('queued-message-row');
    const content = component.getByTestId('queued-message-content');
    const actions = component.getByTestId('queued-message-actions');
    const initialHeight = (await row.boundingBox())!.height;
    const initialPadding = await content.evaluate((node) => getComputedStyle(node).paddingRight);

    await row.hover();
    const hoverHeight = (await row.boundingBox())!.height;
    await actions.getByRole('button').first().focus();
    const focusHeight = (await row.boundingBox())!.height;

    expect(initialPadding).toBe('96px');
    expect(hoverHeight).toBeCloseTo(initialHeight, 1);
    expect(focusHeight).toBeCloseTo(initialHeight, 1);
  });
}

test('supports click, keyboard, focus, reduced motion, and a live collapsed count', async ({
  mount,
  page,
}) => {
  const component = await mount(QueuedMessageGeometryHost, {
    props: { width: 360, zoom: 1, messageCount: 1 },
  });
  const disclosure = component.getByTestId('queued-messages-disclosure');
  const rows = component.getByTestId('queued-message-row');
  const chevron = component.getByTestId('queued-messages-chevron').locator('svg');
  const controlsId = await disclosure.getAttribute('aria-controls');

  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(chevron).not.toHaveClass(/rotate-90/);
  await expect(component.locator(`#${controlsId}`)).toHaveCount(1);
  await expect(rows).toHaveCount(1);

  await disclosure.focus();
  await disclosure.click();
  await expect(disclosure).toBeFocused();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(chevron).toHaveClass(/rotate-90/);
  await expect(rows).toHaveCount(0);

  await component.update({ props: { width: 360, zoom: 1, messageCount: 3 } });
  await expect(component.getByTestId('queued-messages-label')).toHaveText('3 queued messages');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(rows).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedTransitionSeconds = await component
    .getByTestId('queued-messages-chevron')
    .locator('svg')
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration));
  expect(reducedTransitionSeconds).toBeLessThanOrEqual(0.00001);
  await disclosure.press('Enter');
  await expect(disclosure).toBeFocused();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(chevron).not.toHaveClass(/rotate-90/);
  await expect(rows).toHaveCount(3);
  expect(await component.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);

  await disclosure.press('Space');
  await expect(disclosure).toBeFocused();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(chevron).toHaveClass(/rotate-90/);
  await expect(rows).toHaveCount(0);
});

test('preserves the edit, remove, and send-now callbacks', async ({ mount }) => {
  const component = await mount(QueuedMessageGeometryHost, {
    props: { width: 360, zoom: 1, messageCount: 1 },
  });
  const row = component.getByTestId('queued-message-row');
  const actions = component.getByTestId('queued-message-actions').getByRole('button');
  const lastAction = component.getByTestId('queued-message-last-action');

  await expect(actions).toHaveCount(3);
  await row.hover();

  await actions.nth(0).click();
  await expect(lastAction).toHaveText('send:queued-geometry-0');

  await actions.nth(2).click();
  await expect(lastAction).toHaveText('remove:queued-geometry-0');

  await actions.nth(1).click();
  await expect(lastAction).toHaveText('edit:queued-geometry-0');
  await expect(component.locator('textarea')).toHaveValue(
    'A long queued message must keep exactly the same height when actions appear',
  );
});

test('never spawns a horizontal scrollbar in the transcript scroll viewport', async ({
  mount,
  page,
}) => {
  await page.addStyleTag({
    content: `
      [data-testid='queued-message-scroll-viewport'] {
        border-right: 16px solid transparent;
      }

      [data-testid='queued-message-scroll-viewport']::-webkit-scrollbar {
        width: 16px;
        height: 16px;
      }
    `,
  });
  const component = await mount(QueuedMessageGeometryHost, {
    props: { width: 720, contentWidth: 480, zoom: 1, messageCount: 20, scrollViewport: true },
  });
  const viewport = component.getByTestId('queued-message-scroll-viewport');
  const metrics = await viewport.evaluate((node) => ({
    offsetWidth: (node as HTMLElement).offsetWidth,
    offsetHeight: (node as HTMLElement).offsetHeight,
    clientWidth: node.clientWidth,
    clientHeight: node.clientHeight,
    scrollWidth: node.scrollWidth,
    scrollHeight: node.scrollHeight,
    overflowX: getComputedStyle(node).overflowX,
    overflowY: getComputedStyle(node).overflowY,
    reservedLaneWidth: Number.parseFloat(getComputedStyle(node).borderRightWidth),
  }));
  // Classic scrollbars can reserve a vertical gutter, while overlay scrollbars do not.
  expect(metrics.clientWidth).toBeLessThanOrEqual(metrics.offsetWidth);
  expect(metrics.scrollWidth).toBeCloseTo(metrics.clientWidth, 1);
  // Regression (intent-hq/monorepo#2969): the horizontal axis must not be
  // user-scrollable. The computed-style check is the primary pin — headless CT
  // renders no classic scrollbar, so the height check below only guards
  // scrollbar-consumed height in headful/classic-scrollbar renderings.
  expect(metrics.overflowX).toBe('hidden');
  expect(metrics.offsetHeight - metrics.clientHeight).toBe(0);
});

test('renders no generated top divider', async ({ mount }) => {
  const component = await mount(QueuedMessageGeometryHost, {
    props: { width: 720, contentWidth: 480, zoom: 1, messageCount: 1 },
  });
  const queue = component.getByTestId('queued-messages-container');
  const geometry = await queue.evaluate((node) => ({
    contentWidth: node.getBoundingClientRect().width,
    pseudoContent: getComputedStyle(node, '::before').content,
  }));

  expect(geometry.contentWidth).toBeCloseTo(480, 1);
  expect(geometry.pseudoContent).toBe('none');
});

for (const state of [
  { name: 'narrow at 100%', viewportWidth: 390, width: 360, zoom: 1 },
  { name: 'wide at 100%', viewportWidth: 900, width: 720, zoom: 1 },
  { name: 'narrow at 200%', viewportWidth: 390, width: 180, zoom: 2 },
  { name: 'wide at 200%', viewportWidth: 900, width: 360, zoom: 2 },
]) {
  test(`aligns the queue surface with the prompt box at ${state.name}`, async ({ mount, page }) => {
    await page.setViewportSize({ width: state.viewportWidth, height: 900 });
    const component = await mount(QueuedMessageGeometryHost, {
      props: { width: state.width, zoom: state.zoom, alignWithPrompt: true },
    });
    const [queue, prompt] = await Promise.all([
      component.getByTestId('queued-messages-container').boundingBox(),
      component.getByTestId('queued-message-prompt-bounds').boundingBox(),
    ]);

    expect(queue).not.toBeNull();
    expect(prompt).not.toBeNull();
    expect(queue!.x).toBeCloseTo(prompt!.x, 1);
    expect(queue!.x + queue!.width).toBeCloseTo(prompt!.x + prompt!.width, 1);
  });
}

for (const state of [
  { name: 'one message narrow', width: 240, zoom: 1, messageCount: 1 },
  { name: 'multiple messages narrow', width: 240, zoom: 1, messageCount: 3 },
  { name: 'one message at 200% zoom', width: 120, zoom: 2, messageCount: 1 },
  { name: 'multiple messages at 200% zoom', width: 120, zoom: 2, messageCount: 3 },
]) {
  test(`keeps disclosure geometry exact with ${state.name}`, async ({ mount }) => {
    const component = await mount(QueuedMessageGeometryHost, { props: state });
    const container = component.getByTestId('queued-messages-container');
    const disclosure = component.getByTestId('queued-messages-disclosure');
    const label = component.getByTestId('queued-messages-label');
    const chevron = component.getByTestId('queued-messages-chevron');
    const messageRows = component.getByTestId('queued-message-row');
    const firstText = component.getByTestId('queued-message-text').first();

    const containerBox = await container.boundingBox();
    const disclosureBox = await disclosure.boundingBox();
    const labelBox = await label.boundingBox();
    const chevronBox = await chevron.boundingBox();
    const firstTextBox = await firstText.boundingBox();
    const lastRowBox = await messageRows.last().boundingBox();

    expect(containerBox).not.toBeNull();
    expect(disclosureBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(chevronBox).not.toBeNull();
    expect(firstTextBox).not.toBeNull();
    expect(lastRowBox).not.toBeNull();
    expect(chevronBox!.width).toBeCloseTo(16 * state.zoom, 1);
    expect(chevronBox!.height).toBeCloseTo(16 * state.zoom, 1);
    expect(
      disclosureBox!.x + disclosureBox!.width - (chevronBox!.x + chevronBox!.width),
    ).toBeCloseTo(10 * state.zoom, 1);
    expect(labelBox!.x).toBeCloseTo(firstTextBox!.x, 1);
    expect(await container.evaluate((node) => getComputedStyle(node).paddingBottom)).toBe('8px');

    const containerBottom = containerBox!.y + containerBox!.height;
    const lastRowBottom = lastRowBox!.y + lastRowBox!.height;
    expect(containerBottom - lastRowBottom).toBeCloseTo(8 * state.zoom, 1);

    await disclosure.click();
    await expect(messageRows).toHaveCount(0);
    const collapsedContainerBox = (await container.boundingBox())!;
    const collapsedDisclosureBox = (await disclosure.boundingBox())!;
    expect(
      collapsedContainerBox.y +
        collapsedContainerBox.height -
        (collapsedDisclosureBox.y + collapsedDisclosureBox.height),
    ).toBeCloseTo(8 * state.zoom, 1);
  });
}
