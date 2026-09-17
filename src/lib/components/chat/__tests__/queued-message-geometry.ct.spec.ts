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

    expect(initialPadding).toBe('0px');
    expect(hoverHeight).toBeCloseTo(initialHeight, 1);
    expect(focusHeight).toBeCloseTo(initialHeight, 1);
  });
}

test('packs queued rows together without shrinking keyboard action targets', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(QueuedMessageGeometryHost, {
    props: { width: 240, zoom: 1, messageCount: 3 },
  });
  await page.evaluate(() => document.fonts.ready);
  const rows = component.getByTestId('queued-message-row');
  const boxes = await rows.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { y, height } = node.getBoundingClientRect();
      return { y, height };
    }),
  );
  expect(boxes).toHaveLength(3);
  for (let i = 0; i < boxes.length; i += 1) {
    expect(boxes[i].height).toBeCloseTo(28, 1);
    if (i > 0) expect(boxes[i].y - boxes[i - 1].y - boxes[i - 1].height).toBeCloseTo(0, 1);
  }
  const textInsets = await component.evaluate((root) => {
    const label = root
      .querySelector('[data-testid="queued-messages-label"]')!
      .getBoundingClientRect();
    const texts = [...root.querySelectorAll('[data-testid="queued-message-text"]')].map((node) =>
      node.getBoundingClientRect(),
    );
    return {
      afterHeader: texts[0].top - label.bottom,
      betweenRows: texts.slice(1).map((text, i) => text.top - texts[i].bottom),
    };
  });
  expect(textInsets.afterHeader).toBeCloseTo(8, 1);
  expect(textInsets.betweenRows).toEqual([10, 10]);

  const row = rows.nth(1);
  await row.hover();
  const send = row.getByRole('button', { name: 'Send immediately' });
  const target = (await send.boundingBox())!;
  expect(target.width).toBeGreaterThanOrEqual(24);
  expect(target.height).toBeGreaterThanOrEqual(24);
  await send.focus();
  expect((await row.boundingBox())!.height).toBeCloseTo(boxes[1].height, 1);
  await page.keyboard.press('Enter');
  await expect(component.getByTestId('queued-message-last-action')).toHaveText(
    'send:queued-geometry-1',
  );
});

test('keeps loaded and unresolved image tiles tiny-rounded with compact keyboard targets', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(QueuedMessageGeometryHost, {
    props: {
      width: 360,
      imageBlocks: [
        {
          type: 'image',
          data: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48"/></svg>',
          ).toString('base64'),
          mimeType: 'image/svg+xml',
        },
        { type: 'image', attachmentId: 'synthetic-unresolved', mimeType: 'image/png' },
      ],
    },
  });
  await page.evaluate(() => document.fonts.ready);
  const row = component.getByTestId('queued-message-row');
  const thumbnails = row.getByTestId('queued-image-thumbnail');
  const image = thumbnails.first().locator('img');
  const placeholder = thumbnails.last().getByTestId('queued-image-placeholder');
  await expect
    .poll(() => image.evaluate((node) => node.complete && node.naturalWidth > 0))
    .toBe(true);
  const initialBox = (await row.boundingBox())!;
  expect(initialBox.height).toBe(28);
  for (const tile of [image, placeholder]) {
    await expect(tile).toHaveCSS('border-radius', '2px');
    const box = (await tile.boundingBox())!;
    expect(box.width).toBe(box.height);
    expect(box.width).toBeGreaterThan(4);
  }
  for (const thumbnail of await thumbnails.all()) {
    await expect(thumbnail).toHaveCSS('border-radius', '2px');
    expect((await thumbnail.boundingBox())!.height).toBe(28);
  }
  await thumbnails.first().focus();
  await page.keyboard.press('Enter');
  const lightbox = page.getByRole('dialog', { name: 'Image preview' });
  await expect(lightbox).toBeVisible();
  await expect
    .poll(() =>
      lightbox.locator('img').evaluate((node) => ({
        complete: node.complete,
        width: node.naturalWidth,
        height: node.naturalHeight,
      })),
    )
    .toEqual({ complete: true, width: 64, height: 48 });
  await expect(component.locator('textarea')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
  await expect(thumbnails.first()).toBeFocused();
  expect(await row.boundingBox()).toEqual(initialBox);
});

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
  await expect
    .poll(() => component.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);

  await disclosure.press('Space');
  await expect(disclosure).toBeFocused();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(chevron).toHaveClass(/rotate-90/);
  await expect(rows).toHaveCount(0);
});

test('preserves the edit, remove, and send-now callbacks', async ({ mount, page }) => {
  const component = await mount(QueuedMessageGeometryHost, {
    props: { width: 360, zoom: 1, messageCount: 1 },
  });
  const row = component.getByTestId('queued-message-row');
  const actions = component.getByTestId('queued-message-actions').getByRole('button');
  const lastAction = component.getByTestId('queued-message-last-action');

  await expect(actions).toHaveCount(3);
  await row.hover();

  await row.getByRole('button', { name: 'Send immediately' }).focus();
  await page.keyboard.press('Enter');
  await expect(lastAction).toHaveText('send:queued-geometry-0');

  await row.getByTestId('queued-message-content').press('ControlOrMeta+Enter');
  await expect(lastAction).toHaveText('send:queued-geometry-0');

  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(lastAction).toHaveText('remove:queued-geometry-0');

  await row.getByTestId('queued-message-content').dblclick();
  await expect(lastAction).toHaveText('edit:queued-geometry-0');
  await expect(component.locator('textarea')).toHaveValue(
    'A long queued message must keep exactly the same height when actions appear',
  );
});

test('opens the compact pencil action by keyboard without changing row geometry', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(QueuedMessageGeometryHost, {
    props: { width: 240, messageCount: 3 },
  });
  const rows = component.getByTestId('queued-message-row');
  const row = rows.nth(1);
  const initial = (await row.boundingBox())!;
  const content = row.getByTestId('queued-message-content');
  await content.focus();
  await page.keyboard.press('Tab');
  const edit = row.getByRole('button', { name: 'Edit', exact: true });
  await expect(edit).toBeFocused();
  await expect(page.getByRole('tooltip')).toBeVisible();
  expect(await row.boundingBox()).toEqual(initial);
  expect(initial.height).toBeCloseTo(28, 1);
  expect(
    await row
      .getByTestId('queued-message-text')
      .evaluate((node) => getComputedStyle(node).fontWeight),
  ).toBe('400');
  const target = (await edit.boundingBox())!;
  expect(target.width).toBeCloseTo(28, 1);
  expect(target.height).toBeCloseTo(28, 1);
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
  await page.keyboard.press('Enter');
  const editor = row.getByRole('textbox');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('Message 2');
  await editor.fill('Discard draft');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(component.getByTestId('queued-message-last-action')).toHaveText(
    'save:queued-geometry-1',
  );
  expect(await row.boundingBox()).toEqual(initial);
  // Cancelling removes the focused editor; reveal hover-only actions before switching to mouse.
  await row.hover();
  expect(
    await edit.evaluate((button) => {
      const { x, y, width, height } = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(x + width / 2, y + height / 2));
    }),
  ).toBe(true);
  await edit.click();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('Message 2');
  await editor.fill('Save draft');
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(rows).toHaveCount(3);
  expect(await row.boundingBox()).toEqual(initial);
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
    const firstRowBox = await messageRows.first().boundingBox();
    const lastRowBox = await messageRows.last().boundingBox();

    expect(containerBox).not.toBeNull();
    expect(disclosureBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(chevronBox).not.toBeNull();
    expect(firstTextBox).not.toBeNull();
    expect(firstRowBox).not.toBeNull();
    expect(lastRowBox).not.toBeNull();
    expect(disclosureBox!.x).toBeCloseTo(containerBox!.x, 1);
    expect(disclosureBox!.width).toBeCloseTo(containerBox!.width, 1);
    expect(disclosureBox!.height).toBeCloseTo(28 * state.zoom, 1);
    expect(disclosureBox!.y - containerBox!.y).toBeCloseTo(4 * state.zoom, 1);
    expect(firstRowBox!.y).toBeCloseTo(disclosureBox!.y + disclosureBox!.height, 1);
    expect(chevronBox!.width).toBeCloseTo(16 * state.zoom, 1);
    expect(chevronBox!.height).toBeCloseTo(16 * state.zoom, 1);
    expect(labelBox!.x - disclosureBox!.x).toBeCloseTo(14 * state.zoom, 1);
    expect(
      disclosureBox!.x + disclosureBox!.width - (chevronBox!.x + chevronBox!.width),
    ).toBeCloseTo(labelBox!.x - disclosureBox!.x, 1);
    expect(labelBox!.x).toBeCloseTo(firstTextBox!.x, 1);
    expect(firstTextBox!.y - labelBox!.y - labelBox!.height).toBeCloseTo(8 * state.zoom, 1);
    expect(await container.evaluate((node) => getComputedStyle(node).paddingBottom)).toBe('0px');

    const containerBottom = containerBox!.y + containerBox!.height;
    const lastRowBottom = lastRowBox!.y + lastRowBox!.height;
    expect(containerBottom - lastRowBottom).toBeCloseTo(1 * state.zoom, 1);

    await disclosure.focus();
    await disclosure.press('Space');
    await expect(messageRows).toHaveCount(0);
    await expect(disclosure).toBeFocused();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(container).toHaveCSS('padding-top', '0px');
    const collapsedContainerBox = (await container.boundingBox())!;
    const collapsedDisclosureBox = (await disclosure.boundingBox())!;
    const collapsedLabelBox = (await label.boundingBox())!;
    expect(collapsedDisclosureBox.height).toBeCloseTo(28 * state.zoom, 1);
    expect(collapsedDisclosureBox.y).toBeCloseTo(collapsedContainerBox.y, 1);
    expect(collapsedLabelBox.y + collapsedLabelBox.height / 2).toBeCloseTo(
      collapsedDisclosureBox.y + collapsedDisclosureBox.height / 2,
      1,
    );
    expect(collapsedContainerBox.height).toBeCloseTo(29 * state.zoom, 1);
    expect(
      collapsedContainerBox.y +
        collapsedContainerBox.height -
        (collapsedDisclosureBox.y + collapsedDisclosureBox.height),
    ).toBeCloseTo(1 * state.zoom, 1);
    await disclosure.press('Enter');
    await expect(messageRows).toHaveCount(state.messageCount);
    await expect(disclosure).toBeFocused();
    await disclosure.click({ position: { x: 1, y: disclosureBox!.height / 2 } });
    await expect(messageRows).toHaveCount(0);
    await disclosure.click({
      position: { x: disclosureBox!.width - 1, y: disclosureBox!.height / 2 },
    });
    await expect(messageRows).toHaveCount(state.messageCount);
    await expect.poll(() => container.boundingBox()).toEqual(containerBox);
  });
}

for (const theme of ['light', 'dark']) {
  test(`keeps the ${theme} queue transparent with a bottom divider and borderless focused editor`, async ({
    mount,
    page,
  }) => {
    await page.evaluate((theme) => {
      document.documentElement.className = theme;
    }, theme);
    const component = await mount(QueuedMessageGeometryHost, {
      props: { width: 360, messageCount: 2 },
    });
    const queue = component.getByTestId('queued-messages-container');
    await expect(queue).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(queue).toHaveCSS('border-bottom-width', '1px');
    await expect(queue).toHaveCSS('border-bottom-style', 'solid');
    await expect(queue).toHaveCSS('border-top-width', '0px');
    const row = component.getByTestId('queued-message-row').first();
    await row.hover();
    await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await component.getByTestId('queued-message-content').first().dblclick();
    const editor = component.locator('textarea');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(editor).toHaveCSS('border-width', '0px');
    await expect(editor).toHaveCSS('outline-style', 'none');
    const shadowLengths = await editor.evaluate(
      (node) =>
        getComputedStyle(node)
          .boxShadow.match(/-?[\d.]+px/g)
          ?.map(Number.parseFloat) ?? [],
    );
    expect(shadowLengths.every((length) => length === 0)).toBe(true);
    await editor.fill('Updated queued message');
    await editor.press('Enter');
    await expect(editor).toHaveCount(0);
    await expect(component.getByTestId('queued-message-last-action')).toHaveText(
      'save:queued-geometry-0',
    );
    await component.getByTestId('queued-messages-disclosure').click();
    await expect(queue).toHaveCSS('border-bottom-width', '1px');
    await component.update({ props: { width: 360, messageCount: 0 } });
    await expect(queue).toHaveCount(0);
  });
}

test('queue collapse paints intermediate heights before removing the body', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(QueuedMessageGeometryHost, {
    props: { width: 480, messageCount: 3 },
  });
  const disclosure = component.getByTestId('queued-messages-disclosure');
  await expect(component.getByTestId('queued-message-row')).toHaveCount(3);
  const heights = await disclosure.evaluate(async (button) => {
    const body = document.querySelector('[data-testid="queued-messages-content"]')!;
    const heights = [body.getBoundingClientRect().height];
    (button as HTMLButtonElement).click();
    while (body.isConnected && heights.length < 120) {
      await new Promise(requestAnimationFrame);
      heights.push(body.getBoundingClientRect().height);
    }
    return heights;
  });
  expect(heights.some((height) => height > 0 && height < heights[0])).toBe(true);
  await expect(component.getByTestId('queued-messages-content')).toHaveCount(0);
});
